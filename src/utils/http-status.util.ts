import { MessageResponse } from '../types';

export function getMessageResponseHttpStatus(response: MessageResponse): number {
  if (response.success) {
    return 200;
  }

  switch (response.status) {
    case 'invalid_number':
      return 400;
    case 'rate_limited':
      return 429;
    case 'disconnected':
      return 503;
    case 'error':
    case 'sent':
      return 500;
  }
}

export function getMessageResponsesHttpStatus(responses: MessageResponse[]): number {
  if (responses.length === 0) {
    return 500;
  }

  if (responses.every((response) => response.success)) {
    return 200;
  }

  if (responses.some((response) => response.success)) {
    return 207;
  }

  const firstStatus = responses[0].status;
  const allSameFailure = responses.every((response) => response.status === firstStatus);

  if (allSameFailure) {
    return getMessageResponseHttpStatus(responses[0]);
  }

  return 207;
}
