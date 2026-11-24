import mongoose from 'mongoose';

/**
 * Immutable snapshot of a category's scoring setup, written every time scoring is opened (config locked).
 * Score sheets and tabulation results reference the version they were produced under, so history stays
 * consistent even if criteria, judges, or contestants are later edited.
 */
const snapshotSchema = new mongoose.Schema(
  {
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    version: { type: Number, required: true },
    categoryName: String,
    scoringMethod: String,
    customStrategy: String,
    decimalPlaces: Number,
    criteria: [
      {
        _id: false,
        criterionId: mongoose.Schema.Types.ObjectId,
        name: String,
        description: String,
        weight: Number,
        minScore: Number,
        maxScore: Number,
        decimalPlaces: Number,
        order: Number,
      },
    ],
    tieBreakRules: [
      { _id: false, type: { type: String }, criterionId: mongoose.Schema.Types.ObjectId, judgeId: mongoose.Schema.Types.ObjectId },
    ],
    judges: [{ _id: false, userId: mongoose.Schema.Types.ObjectId, name: String, order: Number }],
    contestants: [{ _id: false, contestantId: mongoose.Schema.Types.ObjectId, number: Number, name: String }],
    lockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lockedAt: Date,
    reopenedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reopenedAt: Date,
    reopenReason: String,
  },
  { timestamps: true }
);

snapshotSchema.index({ category: 1, version: 1 }, { unique: true });

export default mongoose.model('ScoringConfiguration', snapshotSchema);
