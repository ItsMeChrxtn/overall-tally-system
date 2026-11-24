import mongoose from 'mongoose';
import { SHEET_STATUS } from '../constants/index.js';

/**
 * One score sheet = one judge evaluating one contestant in one category.
 * Individual criterion scores are embedded so a sheet is saved/submitted atomically.
 * For rank-based categories the judge's placement is stored in `rank`.
 */
const scoreSchema = new mongoose.Schema(
  {
    criterion: { type: mongoose.Schema.Types.ObjectId, ref: 'Criterion', required: true },
    value: { type: Number, required: true },
  },
  { _id: false }
);

const historySchema = new mongoose.Schema(
  {
    action: { type: String, enum: ['saved', 'submitted', 'reopened'], required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date, default: Date.now },
    scores: [scoreSchema],
    rank: Number,
    note: String,
  },
  { _id: false }
);

const sheetSchema = new mongoose.Schema(
  {
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
    judge: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    contestant: { type: mongoose.Schema.Types.ObjectId, ref: 'Contestant', required: true },
    configVersion: { type: Number, required: true },
    scores: { type: [scoreSchema], default: [] },
    rank: Number,
    // Server-computed preview of this sheet (never accepted from the client)
    computedTotal: Number,
    computedWeighted: Number,
    status: { type: String, enum: SHEET_STATUS, default: 'draft', index: true },
    savedAt: Date,
    submittedAt: Date,
    submissionCount: { type: Number, default: 0 },
    reopenedAt: Date,
    reopenedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reopenReason: String,
    history: { type: [historySchema], default: [] },
  },
  { timestamps: true }
);

// Prevents duplicate sheets (and therefore duplicate submissions) per judge/contestant/category
sheetSchema.index({ category: 1, judge: 1, contestant: 1 }, { unique: true });

export default mongoose.model('ScoreSheet', sheetSchema);
