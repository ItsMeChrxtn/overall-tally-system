import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { ROLE_LIST, USER_STATUS } from '../constants/index.js';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 160 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLE_LIST, required: true, index: true },
    status: { type: String, enum: USER_STATUS, default: 'active', index: true },
    // Optional profile details (mostly used for judges on reports)
    title: { type: String, trim: true, maxlength: 120 },
    affiliation: { type: String, trim: true, maxlength: 160 },
    phone: { type: String, trim: true, maxlength: 40 },
    mustChangePassword: { type: Boolean, default: false },
    // false = name-only judge whose paper scores are encoded by the event admin; cannot sign in
    loginEnabled: { type: Boolean, default: true },
    // Incremented on password change / deactivation to invalidate issued JWTs
    tokenVersion: { type: Number, default: 0 },
    resetPasswordTokenHash: { type: String, select: false },
    resetPasswordExpires: { type: Date, select: false },
    lastLoginAt: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

userSchema.methods.setPassword = async function setPassword(plain) {
  this.passwordHash = await bcrypt.hash(plain, 12);
};

userSchema.methods.comparePassword = function comparePassword(plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.methods.toSafeObject = function toSafeObject() {
  return {
    _id: this._id,
    name: this.name,
    email: this.email,
    role: this.role,
    status: this.status,
    title: this.title,
    affiliation: this.affiliation,
    phone: this.phone,
    mustChangePassword: this.mustChangePassword,
    loginEnabled: this.loginEnabled !== false,
    lastLoginAt: this.lastLoginAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    delete ret.resetPasswordTokenHash;
    delete ret.resetPasswordExpires;
    delete ret.tokenVersion;
    delete ret.__v;
    return ret;
  },
});

export default mongoose.model('User', userSchema);
