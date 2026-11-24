import mongoose from 'mongoose';
import { AWARD_BASES, CATEGORY_STATUS, CUSTOM_STRATEGIES, SCORING_METHODS, TIE_RULES } from '../constants/index.js';

const tieRuleSchema = new mongoose.Schema(
  {
    type: { type: String, enum: TIE_RULES, required: true },
    criterion: { type: mongoose.Schema.Types.ObjectId, ref: 'Criterion' },
    judge: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false }
);

/** Extra titles derived from the tally, e.g. "Best Story / Screenplay" = highest in one criterion. */
const specialAwardSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    basis: { type: String, enum: AWARD_BASES, required: true },
    criterion: { type: mongoose.Schema.Types.ObjectId, ref: 'Criterion' },
  },
  { _id: false }
);

const categorySchema = new mongoose.Schema(
  {
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 2000 },
    order: { type: Number, default: 0 },
    scoringMethod: { type: String, enum: SCORING_METHODS, default: 'weighted' },
    customStrategy: { type: String, enum: [...CUSTOM_STRATEGIES, null], default: null },
    decimalPlaces: { type: Number, min: 0, max: 4, default: 2 },
    instructions: { type: String, trim: true, maxlength: 2000 },
    tieBreakRules: { type: [tieRuleSchema], default: [{ type: 'highest_weight_criterion' }, { type: 'shared' }] },
    specialAwards: { type: [specialAwardSchema], default: [] },
    contestants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Contestant' }],
    includeInOverall: { type: Boolean, default: false },
    overallWeight: { type: Number, min: 0, max: 100, default: 0 },
    status: { type: String, enum: CATEGORY_STATUS, default: 'setup' },
    configLocked: { type: Boolean, default: false },
    configVersion: { type: Number, default: 0 },
    lockedAt: Date,
    lockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

categorySchema.index({ event: 1, name: 1 }, { unique: true });
categorySchema.index({ event: 1, order: 1 });

export default mongoose.model('Category', categorySchema);
