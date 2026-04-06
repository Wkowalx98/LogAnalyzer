const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['Nowe', 'W trakcie realizacji', 'Rozwiązane'],
        default: 'Nowe'
    },
    priority: {
        type: String,
        enum: ['Niski', 'Średni', 'Wysoki', 'Krytyczny'],
        default: 'Średni'
    },
    deadline: {
        type: Date
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    authorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    attachedLogName: {
        type: String,
        default: null
    },
    errorCount: {
        type: Number,
        default: null
    },
    warningCount: {
        type: Number,
        default: null
    },
    resolution: {
        type: String,
        default: null
    },
    rawLogContent: {
        type: String,
        default: null
    },
    errorSignatures: {
        type: [String],
        default: []
    }
});

module.exports = mongoose.model('Ticket', ticketSchema);