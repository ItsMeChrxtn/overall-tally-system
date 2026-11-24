import { z } from 'zod';
import User from '../models/User.js';
import Setting from '../models/Setting.js';
import ApiError from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { parse, passwordSchema } from '../utils/validation.js';
import { randomToken, sha256, signToken } from '../utils/token.js';
import { audit } from '../services/auditService.js';
import { sendMail } from '../services/mailer.js';
import { env } from '../config/env.js';

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = parse(loginSchema, req.body);
  const user = await User.findOne({ email }).select('+passwordHash +tokenVersion');
  if (!user || !(await user.comparePassword(password))) {
    await audit(req, { action: 'auth.login_failed', entityType: 'User', entityLabel: email, user: user ? user : { name: email } });
    throw ApiError.unauthorized('Incorrect email or password.', 'INVALID_CREDENTIALS');
  }
  if (user.status !== 'active') throw ApiError.unauthorized('Your account has been deactivated. Contact your administrator.', 'ACCOUNT_INACTIVE');
  if (user.loginEnabled === false) throw ApiError.unauthorized('This judge account is encode-only and cannot sign in.', 'LOGIN_DISABLED');

  user.lastLoginAt = new Date();
  await user.save();
  await audit(req, { action: 'auth.login', entityType: 'User', entityId: user._id, entityLabel: user.email, user });
  res.json({ success: true, token: signToken(user), user: user.toSafeObject() });
});

export const me = asyncHandler(async (req, res) => {
  res.json({ success: true, user: req.user.toSafeObject() });
});

export const logout = asyncHandler(async (req, res) => {
  await audit(req, { action: 'auth.logout', entityType: 'User', entityId: req.user._id, entityLabel: req.user.email });
  res.json({ success: true });
});

export const changePassword = asyncHandler(async (req, res) => {
  const settings = await Setting.getGlobal();
  const { currentPassword, newPassword } = parse(
    z.object({ currentPassword: z.string().min(1, 'Current password is required'), newPassword: passwordSchema(settings.passwordMinLength) }),
    req.body
  );
  const user = await User.findById(req.user._id).select('+passwordHash +tokenVersion');
  if (!(await user.comparePassword(currentPassword))) throw ApiError.badRequest('Current password is incorrect.', 'INVALID_PASSWORD');
  if (currentPassword === newPassword) throw ApiError.badRequest('The new password must be different from the current one.');
  await user.setPassword(newPassword);
  user.mustChangePassword = false;
  user.tokenVersion = (user.tokenVersion || 0) + 1; // signs out other sessions
  await user.save();
  await audit(req, { action: 'auth.password_changed', entityType: 'User', entityId: user._id, entityLabel: user.email });
  res.json({ success: true, message: 'Password updated.', token: signToken(user), user: user.toSafeObject() });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = parse(z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email') }), req.body);
  const user = await User.findOne({ email, status: 'active' });
  if (user) {
    const token = randomToken();
    user.resetPasswordTokenHash = sha256(token);
    user.resetPasswordExpires = new Date(Date.now() + 30 * 60 * 1000);
    await user.save();
    const link = `${env.clientUrls[0]}/reset-password/${token}`;
    await sendMail({
      to: user.email,
      subject: 'Reset your Overall Tally password',
      text: `Hello ${user.name},\n\nUse this link within 30 minutes to reset your password:\n${link}\n\nIf you did not request this, you can ignore this email.`,
    });
    await audit(req, { action: 'auth.password_reset_requested', entityType: 'User', entityId: user._id, entityLabel: user.email, user });
  }
  // Same response either way to avoid revealing which emails exist
  res.json({ success: true, message: 'If that email belongs to an active account, a reset link has been sent.' });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const settings = await Setting.getGlobal();
  const { password } = parse(z.object({ password: passwordSchema(settings.passwordMinLength) }), req.body);
  const user = await User.findOne({
    resetPasswordTokenHash: sha256(req.params.token || ''),
    resetPasswordExpires: { $gt: new Date() },
  }).select('+resetPasswordTokenHash +resetPasswordExpires +tokenVersion');
  if (!user) throw ApiError.badRequest('This reset link is invalid or has expired.', 'INVALID_RESET_TOKEN');
  await user.setPassword(password);
  user.resetPasswordTokenHash = undefined;
  user.resetPasswordExpires = undefined;
  user.mustChangePassword = false;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  await audit(req, { action: 'auth.password_reset', entityType: 'User', entityId: user._id, entityLabel: user.email, user });
  res.json({ success: true, message: 'Password reset. You can now sign in.' });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const data = parse(
    z.object({
      name: z.string().trim().min(2).max(120).optional(),
      title: z.string().trim().max(120).optional(),
      affiliation: z.string().trim().max(160).optional(),
      phone: z.string().trim().max(40).optional(),
    }),
    req.body
  );
  Object.assign(req.user, data);
  await req.user.save();
  res.json({ success: true, user: req.user.toSafeObject() });
});
