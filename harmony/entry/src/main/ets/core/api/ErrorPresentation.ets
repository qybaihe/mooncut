import { BusinessError } from '@kit.BasicServicesKit';

export function presentError(error: object): string {
  if (error instanceof Error && error.message) return error.message;
  const businessError = error as BusinessError;
  if (businessError.message) {
    return businessError.code ? `${businessError.message}（${businessError.code}）` : businessError.message;
  }
  return '操作失败，请重试';
}

export function standardError(error: object): Error {
  return error instanceof Error ? error : new Error(presentError(error));
}
