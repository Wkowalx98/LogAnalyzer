//Importowanie modułów
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcrypt');
const User = require('./models/User');
const Ticket = require('./models/Ticket');
const multer = require('multer');
const fs = require('fs');
const readline = require('readline');

//start aplikacji
const app = express();
const PORT = 3000;

//Konfiguracja sesji
app.use(session({
    secret: 'tajny-klucz-do-sesji',
    resave: false,
    saveUninitialized: false
}));

const upload = multer({ dest: 'uploads/' });

//Konfiguracja bazy danych
const mongoURI = 'mongodb://127.0.0.1:27017/helpdesk';
mongoose.connect(mongoURI)
    .then(() => console.log('Połączono z lokalną bazą.'))
    .catch((err) => console.error('Błąd połączenia z MongoDB:', err));

const requireLogin = async (req, res, next) => {
    if (req.session.userId) {
        try{
            const user = await User.findById(req.session.userId);
            if(!user){
                return res.redirect('/login');
            }

            req.user = user;
            res.locals.user = user;
            next();
        } catch(error) {
            console.error('Błąd autoryzacji:', error);
            res.redirext('/login');
        }
    } else {
        res.redirect('/login');
    }
};

app.set('view engine', 'ejs');

app.use(express.urlencoded({extended: true}));

app.get('/', requireLogin, async (req, res) => {
    try {
        if (req.user.role === 'admin') {
            //Widok administratora/technika
            const newTicketsCount = await Ticket.countDocuments({ status: 'Nowe' });
            const inProgressTicketsCount = await Ticket.countDocuments({ status: 'W trakcie realizacji' });
            const closedTicketsCount = await Ticket.countDocuments({ status: 'Rozwiązane' });
            
            const recentLogs = await Ticket.find({ attachedLogName: { $ne: null } })
                                           .sort({ createdAt: -1 })
                                           .limit(5);

            res.render('dashboard', { 
                newTickets: newTicketsCount, 
                inProgressTickets: inProgressTicketsCount,
                closedTickets: closedTicketsCount,
                recentLogs: recentLogs
            });
        } else {
            //Widok uytkownika
            const userTickets = await Ticket.find({ authorId: req.user._id }).sort({ createdAt: -1 }).limit(5);
            const myActiveTickets = await Ticket.countDocuments({ authorId: req.user._id, status: { $in: ['Nowe', 'W trakcie realizacji'] } });

            res.render('dashboard', {
                userTickets: userTickets,
                myActiveTickets: myActiveTickets
            });
        }
    } catch (error) {
        console.error('Błąd ładowania dashboardu:', error);
        res.send('Wystąpił błąd podczas ładowania panelu głównego.');
    }
});

// Wyświetlanie formularza logowania
app.get('/login', (req, res) => {
    res.render('login');
});

//Odbieranie danych z formularza logowania
app.post('/login', async (req, res) => {
    try{
        const { username, password } = req.body;
        const user = await User.findOne({ username: username });

        if(!user){
            return res.send('Nieprawidłowy login lub hasło.');
        }

        const isMatch = await bcrypt.compare(password, user.password);

        if(!isMatch){
            return res.send('Nieprawidłowy login lub hasło.');
        }

        req.session.userId = user._id;

        res.redirect('/');
    }catch (error){
        console.error('Błąd logowania:', error);
        res.send('Wystąpił błąd podczas logowania.');
    }
})

//Wylogowanie
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if(err) {
            console.error('Błąd podczas wylogowywania:', err);
            return res.send('Błąd wylogowywania');
        }
        res.redirect('/login');
    });
});

// --- MODUŁ ZGŁOSZEŃ ---
//Wyświetlanie strony zgłoszeń
app.get('/tickets', requireLogin, async (req, res) => {
    try {
        if (req.user.role === 'admin') {
            const allTickets = await Ticket.find().populate('assignedTo').sort({ createdAt: -1 });

            const unassignedTickets = allTickets.filter(t => !t.assignedTo);
            const assignedTickets = allTickets.filter(t => t.assignedTo);

            // Pogrupowane przypisane zgloszenia
            const groupedByTech = {};
            assignedTickets.forEach(t => {
                const techName = t.assignedTo.username;
                if (!groupedByTech[techName]) groupedByTech[techName] = [];
                groupedByTech[techName].push(t);
            });

            res.render('tickets', { 
                unassignedTickets: unassignedTickets, 
                groupedByTech: groupedByTech,
                tickets: []
            });
        } else {
            //Widok zwyklego usera
            const userTickets = await Ticket.find({ authorId: req.user._id }).sort({ createdAt: -1 });
            res.render('tickets', { tickets: userTickets });
        }
    } catch (error) {
        console.error(error);
        res.send('Wystąpił błąd serwera.');
    }
});
//Wyświetlanie konkretnego zgłoszenia
app.get('/tickets/:id', requireLogin, async (req, res) => {
    try {
        const ticket = await Ticket.findById(req.params.id).populate('assignedTo').populate('authorId');
        if (!ticket) return res.send('Nie znaleziono zgłoszenia.');
        
        if (req.user.role !== 'admin' && ticket.authorId._id.toString() !== req.user._id.toString()) {
            return res.send('Odmowa dostępu. To nie jest Twoje zgłoszenie.');
        }

        let similarTickets = [];

        if (ticket.errorSignatures && ticket.errorSignatures.length > 0) {
            similarTickets = await Ticket.find({
                errorSignatures: { $in: ticket.errorSignatures },
                status: 'Rozwiązane',
                _id: { $ne: ticket._id }
            }).limit(2);
        }

        res.render('ticket_details', { ticket: ticket, similarTickets: similarTickets });
    } catch (error) {
        console.error(error);
        res.send('Błąd podczas ładowania zgłoszenia.');
    }
});
//Przejecie zgloszenia przez technika
app.post('/tickets/:id/assign', requireLogin, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.send('Brak uprawnień.');

        await Ticket.findByIdAndUpdate(req.params.id, {
            assignedTo: req.user._id,
            status: 'W trakcie realizacji'
        });

        res.redirect('/tickets/' + req.params.id);
    } catch (error) {
        console.error(error);
        res.send('Błąd podczas przypisywania zgłoszenia.');
    }
});
//Dodawanie nowego zgłoszenia
app.post('/tickets', requireLogin, upload.single('logfile'), async (req, res) => {
    try {
        const { title, description, priority } = req.body;
        
        let hoursToResolve = 24;    //Domyślnie priority ustawiony na "Średni"
        if (priority === 'Krytyczny') hoursToResolve = 4;
        if (priority === 'Wysoki') hoursToResolve = 8;
        if (priority === 'Niski') hoursToResolve = 72;

        const deadlineDate = new Date();
        deadlineDate.setHours(deadlineDate.getHours() + hoursToResolve);

        let errorCount = null;
        let warningCount = null;
        let attachedLogName = null;
        let rawLogContent = null;
        let errorSignatures = [];

        if (req.file) {
            errorCount = 0;
            warningCount = 0;
            attachedLogName = req.file.originalname;

            const fileStream = fs.createReadStream(req.file.path);
            const rl = readline.createInterface({
                input: fileStream,
                crlfDelay: Infinity
            });

            for await (const line of rl) {
                const upperLine = line.toUpperCase();
                
                if (upperLine.includes('[ERROR]')) {
                    errorCount++;
                    
                    const errorStartIndex = upperLine.indexOf('[ERROR]');
                    const pureErrorSignature = line.substring(errorStartIndex);
                    
                    if (errorSignatures.length < 5 && !errorSignatures.includes(pureErrorSignature)) {
                        errorSignatures.push(pureErrorSignature);
                    }
                }
                
                if (upperLine.includes('[WARNING]')) {
                    warningCount++;
                }
            }

            rawLogContent = fs.readFileSync(req.file.path, 'utf8');
            fs.unlinkSync(req.file.path);
        }

        await Ticket.create({
            title: title,
            description: description,
            priority: priority || 'Średni',
            deadline: deadlineDate,
            authorId: req.session.userId,
            attachedLogName: attachedLogName,
            errorCount: errorCount,
            warningCount: warningCount,
            rawLogContent: rawLogContent,
            errorSignatures: errorSignatures
        });

        res.redirect('/tickets');

    } catch (error) {
        console.error('Błąd podczas dodawania zgłoszenia:', error);
        res.send('Wystąpił błąd podczas dodawania zgłoszenia.');
    }
});
//Dodawanie rozwiązania przez admina
app.post('/tickets/:id/resolve', requireLogin, async (req, res) => {
    try {
        //Zabezpieczenie: Tylko admin może to zrobić
        if (req.user.role !== 'admin') {
            return res.send('Brak uprawnień. Tylko technik może rozwiązać zgłoszenie.');
        }

        const { resolution, status } = req.body;

        await Ticket.findByIdAndUpdate(req.params.id, {
            resolution: resolution,
            status: status
        });

        res.redirect('/tickets/' + req.params.id);

    } catch (error) {
        console.error(error);
        res.send('Błąd podczas zapisywania rozwiązania.');
    }
});

//Start serwera
app.listen(PORT, () => {
    console.log(`Serwer wystartował na porcie http://localhost:${PORT}`);
});