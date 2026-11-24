import mongoose from 'mongoose';

const Mixed = mongoose.Schema.Types.Mixed;

const auditSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    userName: String,
    userRole: String,
    action: { type: String, required: true, index: true },
    entityType: { type: String, index: true },
    entityId: mongoose.Schema.Types.ObjectId,
    entityLabel: String,
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', index: true },
    before: Mixed,
    after: Mixed,
    meta: Mixed,
    ip: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditSchema.index({ createdAt: -1 });

// Audit logs are append-only: block every update/delete path at the model level.
const blocked = function blocked(next) {
  next(new Error('Audit logs are immutable and cannot be modified or deleted.'));
};
for (const op of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndReplace',
  'replaceOne',
  'deleteOne',
  'deleteMany',
]) {
  auditSchema.pre(op, blocked);
}
auditSchema.pre('save', function preventEdit(next) {
  if (!this.isNew) return next(new Error('Audit logs are immutable and cannot be modified.'));
  next();
});

export default mongoose.model('AuditLog', auditSchema);
