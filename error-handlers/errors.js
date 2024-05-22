class UserError extends Error {
  constructor(message, displayMessage) {
    super(message);
    this.name = 'UserError';
    this.displayMessage = displayMessage || message;
    this.code = 400;
  }
}

class InvalidInputError extends UserError {
  constructor(message, code) {
    super(message);
    this.name = 'InvalidInputError';
    if (code) this.code = code;
  }
}
module.exports = { InvalidInputError, UserError };  