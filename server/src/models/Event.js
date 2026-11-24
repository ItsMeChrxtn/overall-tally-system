import mongoose from 'mongoose';
import { EVENT_STATUSES, EVENT_TYPES, OVERALL_METHODS } from '../constants/index.js';

const eventSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 4000 },
    eventType: { type: String, enum: EVENT_TYPES, default: 'other' },
    coverImage: String,
    venue: { type: String, trim: true, maxlength: 200 },
    eventDate: Date,
    startDate: Date,
    endDate: Date,
    organizer: { type: String, trim: true, maxlength: 160 },
    status: { type: String, enum: EVENT_STATUSES, default: 'draft', index: true },
    settings: {
      allowMultiCategoryContestants: { type: Boolean, default: true },
      judgesCanViewOwnSubmitted: { type: Boolean, default: true },
      allowIncompleteRanking: { type: Boolean, default: false },
      publicShowScores: { type: Boolean, default: true },
    },
    // Optional event-wide "overall" tally that combines several categories
    overall: {
      enabled: { type: Boolean, default: false },
      title: { type: String, trim: true, default: 'Overall Tally', maxlength: 120 },
      method: { type: String, enum: OVERALL_METHODS, default: 'weighted' },
      decimalPlaces: { type: Number, min: 0, max: 4, default: 2 },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    archivedAt: Date,
    publishedAt: Date,
    completedAt: Date,
  },
  { timestamps: true }
);

eventSchema.index({ name: 'text', venue: 'text' });
eventSchema.index({ createdAt: -1 });

export default mongoose.model('Event', eventSchema);
