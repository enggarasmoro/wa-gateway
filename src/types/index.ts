export interface SendMessageRequest {
  target: string;
  message: string;
  countryCode?: string;
}

export interface BroadcastRequest {
  targets: string[];
  message: string;
}

export interface MessageResponse {
  success: boolean;
  status: 'sent' | 'error' | 'disconnected' | 'invalid_number';
  message: string;
  target?: string;
  id?: string;
}

export interface HealthResponse {
  status: 'connected' | 'disconnected' | 'connecting';
  uptime: number;
  phone?: string;
  timestamp: string;
}

export interface ConnectionState {
  isConnected: boolean;
  phoneNumber?: string;
  startTime: Date;
  qrDisplayed: boolean;
}
