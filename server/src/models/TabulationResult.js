import mongoose from 'mongoose';
import { RESULT_STATUS } from '../constants/index.js';

const Mixed = mongoose.Schema.Types.Mixed;

/**
 * A saved, versioned tabulation. A category (or the event overall) can have many versions;
 * only one can be in an active approval state at a time. Rows are stored as computed by the
 * backend scoring engine so the official record never changes after the fact.
 */
const resultSchema = new mongoose.Schema(
  {
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null, index: true },
    scope: { type: String, enum: ['category', 'overall'], default: 'category' },
    title: String,
    version: { type: Number, required: true },
    configVersion: Number,
    status: { type: String, enum: RESULT_STATUS, default: 'preliminary', index: true },
    scoringMethod: String,
    customStrategy: String,
    decimalPlaces: Number,
    direction: { type: String, enum: ['asc', 'desc'], default: 'desc' },
    complete: Boolean,
    judges: Mixed,
    criteria: Mixed,
    rows: Mixed,
    ties: Mixed,
    missing: Mixed,
    warnings: [String],
    summary: Mixed,
    dataHash: String,
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    generatedAt: Date,
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    submittedAt: Date,
    verificationNote: String,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    returnedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    returnedAt: Date,
    returnReason: String,
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    publishedAt: Date,
  },
  { timestamps: true }
);

resultSchema.index({ event: 1, category: 1, scope: 1, version: -1 });

export default mongoose.model('TabulationResult', resultSchema);
