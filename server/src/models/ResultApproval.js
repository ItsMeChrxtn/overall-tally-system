import mongoose from 'mongoose';

/** Approval history for tabulation results (append-only). */
const approvalSchema = new mongoose.Schema(
  {
    result: { type: mongoose.Schema.Types.ObjectId, ref: 'TabulationResult', required: true, index: true },
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    action: {
      type: String,
      enum: ['generated', 'submitted', 'approved', 'returned', 'published', 'unpublished'],
      required: true,
    },
    fromStatus: String,
    toStatus: String,
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: String,
    byRole: String,
    note: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export default mongoose.model('ResultApproval', approvalSchema);
