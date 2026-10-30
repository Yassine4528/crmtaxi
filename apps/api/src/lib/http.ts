export class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const forbidden = (message = 'Action non autorisée.') => new HttpError(403, message);
export const notFound = (message = 'Élément introuvable.') => new HttpError(404, message);
