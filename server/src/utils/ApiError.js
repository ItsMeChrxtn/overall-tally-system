export default class ApiError extends Error {
  constructor(status, message, code = undefined, extra = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  static badRequest(msg, code = 'BAD_REQUEST', extra) {
    return new ApiError(400, msg, code, extra);
  }
  static unauthorized(msg = 'Authentication required.', code = 'UNAUTHORIZED') {
    return new ApiError(401, msg, code);
  }
  static forbidden(msg = 'You do not have permission to perform this action.', code = 'FORBIDDEN') {
    return new ApiError(403, msg, code);
  }
  static notFound(msg = 'Resource not found.', code = 'NOT_FOUND') {
    return new ApiError(404, msg, code);
  }
  static conflict(msg, code = 'CONFLICT', extra) {
    return new ApiError(409, msg, code, extra);
  }
}
