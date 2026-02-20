export class DatalatheError extends Error {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "DatalatheError";
    this.statusCode = statusCode;
  }
}

export class DatalatheApiError extends DatalatheError {
  public readonly responseBody?: string;

  constructor(message: string, statusCode: number, responseBody?: string) {
    super(message, statusCode);
    this.name = "DatalatheApiError";
    this.responseBody = responseBody;
  }
}

export class DatalatheStageError extends DatalatheError {
  constructor(message: string) {
    super(message);
    this.name = "DatalatheStageError";
  }
}
