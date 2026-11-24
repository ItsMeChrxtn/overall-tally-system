import mongoose from 'mongoose';

/** JudgingCriteria — always configured per category, never hardcoded. */
const criterionSchema = new mongoose.Schema(
  {
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 1000 },
    weight: { type: Number, min: 0, max: 100, default: 0 },
    minScore: { type: Number, default: 0 },
    maxScore: { type: Number, default: 100 },
    decimalPlaces: { type: Number, min: 0, max: 4, default: 2 },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

criterionSchema.index({ category: 1, order: 1 });

export default mongoose.model('Criterion', criterionSchema, 'judgingcriteria');
