export class RedisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, RedisError.prototype);
  }
}

export class ParserError extends RedisError {
  buffer: string;
  offset: number;

  constructor(message: string, buffer: string, offset: number) {
    super(message);
    this.buffer = buffer;
    this.offset = offset;
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, ParserError.prototype);
  }
}

export class ReplyError extends RedisError {
  command?: string;
  args?: any[];
  code?: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, ReplyError.prototype);
  }
}

export class AbortError extends RedisError {
  command?: string;
  args?: any[];

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, AbortError.prototype);
  }
}

export class InterruptError extends RedisError {
  command?: string;
  args?: any[];
  origin: Error;

  constructor(message: string, origin: Error) {
    super(message);
    this.origin = origin;
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, InterruptError.prototype);
  }
}
