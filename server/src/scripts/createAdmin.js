/**
 * Creates (or resets) a Super Admin account without wiping data.
 *   npm run create-admin -- --name "Jane Admin" --email jane@example.com --password "S3cure-Passw0rd"
 */
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import User from '../models/User.js';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const name = arg('name') || 'System Administrator';
const email = (arg('email') || '').toLowerCase().trim();
const password = arg('password');

if (!email || !password) {
  console.error('Usage: npm run create-admin -- --name "Full Name" --email you@example.com --password "StrongPassw0rd"');
  process.exit(1);
}
if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
  console.error('Password must be at least 8 characters and contain letters and numbers.');
  process.exit(1);
}

await connectDB();
let user = await User.findOne({ email }).select('+tokenVersion');
if (user) {
  user.role = 'super_admin';
  user.status = 'active';
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  console.log(`[create-admin] Updating existing account ${email} to an active Super Admin.`);
} else {
  user = new User({ name, email, role: 'super_admin' });
  console.log(`[create-admin] Creating Super Admin ${email}.`);
}
await user.setPassword(password);
await user.save();
await mongoose.disconnect();
console.log('[create-admin] Done.');
