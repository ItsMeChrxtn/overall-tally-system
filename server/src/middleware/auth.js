import User from '../models/User.js';
import ApiError from '../utils/ApiError.js';
import { verifyToken } from '../utils/token.js';

// Routes a user who must change their password can still reach
const PASSWORD_CHANGE_ALLOWLIST = ['/api/auth/me', '/api/auth/change-password', '/api/auth/logout'];

export async function protect(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw ApiError.unauthorized();

    let payload;
    try {
      payload = verifyToken(token);
    } catch (err) {
      throw ApiError.unauthorized(
        err.name === 'TokenExpiredError' ? 'Your session has expired. Please sign in again.' : 'Invalid session token.',
        err.name === 'TokenExpiredError' ? 'SESSION_EXPIRED' : 'INVALID_TOKEN'
      );
    }

    const user = await User.findById(payload.sub).select('+tokenVersion');
    if (!user) throw ApiError.unauthorized('Account no longer exists.', 'INVALID_TOKEN');
    if (user.status !== 'active') throw ApiError.unauthorized('Your account has been deactivated.', 'ACCOUNT_INACTIVE');
    if (user.loginEnabled === false) throw ApiError.unauthorized('This account cannot sign in.', 'LOGIN_DISABLED');
    if ((user.tokenVersion || 0) !== (payload.tv || 0)) {
      throw ApiError.unauthorized('Your session is no longer valid. Please sign in again.', 'SESSION_EXPIRED');
    }
    if (user.mustChangePassword && !PASSWORD_CHANGE_ALLOWLIST.includes(req.originalUrl.split('?')[0])) {
      throw ApiError.forbidden('You must change your password before continuing.', 'PASSWORD_CHANGE_REQUIRED');
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** Restricts a route to the given system roles. */
export const authorize =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) return next(ApiError.forbidden());
    next();
  };
