import mongoose from 'mongoose';
import { ASSIGNMENT_ROLES } from '../constants/index.js';

/**
 * Links a user to an event with an event-level role.
 * Judges additionally carry the list of categories they evaluate, plus their seat order ("Judge 1", "Judge 2", ...).
 */
const assignmentSchema = new mongoose.Schema(
  {
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: ASSIGNMENT_ROLES, required: true },
    categories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
    order: { type: Number, default: 0 },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

assignmentSchema.index({ event: 1, user: 1, role: 1 }, { unique: true });
assignmentSchema.index({ event: 1, role: 1, order: 1 });

export default mongoose.model('EventAssignment', assignmentSchema);
