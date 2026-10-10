import {
  MockPaymentIntent,
  MockTransfer,
  MockRefund,
  StripeWebhookEvent,
} from '@/types/payments';

export interface CreatePaymentIntentParams {
  amount: number; // in cents
  currency: string;
  transfer_group?: string;
  metadata?: Record<string, string>;
  payment_method_types?: string[];
}

export interface CreateTransferParams {
  amount: number; // in cents
  currency: string;
  destination: string; // Connected account ID (e.g. acct_coach_..., acct_gym_...)
  transfer_group?: string;
  metadata?: Record<string, string>;
}

export interface CreateRefundParams {
  payment_intent: string;
  amount?: number;
  reason?: string;
}

export interface RequestOptions {
  idempotencyKey?: string;
}

export class MockStripeService {
  private paymentIntentsStore = new Map<string, MockPaymentIntent>();
  private transfersStore = new Map<string, MockTransfer>();
  private refundsStore = new Map<string, MockRefund>();
  private idempotencyKeys = new Map<string, any>();
  private webhookListeners = new Map<string, Array<(event: StripeWebhookEvent) => Promise<void> | void>>();

  /**
   * PaymentIntents API simulation
   */
  public paymentIntents = {
    create: async (
      params: CreatePaymentIntentParams,
      options?: RequestOptions
    ): Promise<MockPaymentIntent> => {
      if (options?.idempotencyKey && this.idempotencyKeys.has(options.idempotencyKey)) {
        return this.idempotencyKeys.get(options.idempotencyKey);
      }

      const id = `pi_mock_${Math.random().toString(36).substring(2, 12)}_${Date.now()}`;
      const paymentIntent: MockPaymentIntent = {
        id,
        amount: params.amount,
        currency: params.currency.toLowerCase(),
        status: 'requires_confirmation',
        transfer_group: params.transfer_group,
        metadata: params.metadata || {},
        created: Math.floor(Date.now() / 1000),
      };

      this.paymentIntentsStore.set(id, paymentIntent);

      if (options?.idempotencyKey) {
        this.idempotencyKeys.set(options.idempotencyKey, paymentIntent);
      }

      return paymentIntent;
    },

    confirm: async (id: string): Promise<MockPaymentIntent> => {
      const pi = this.paymentIntentsStore.get(id);
      if (!pi) {
        throw new Error(`StripeError: No such payment_intent: '${id}'`);
      }

      pi.status = 'succeeded';

      // Auto-dispatch webhook event
      await this.webhooks.dispatch({
        id: `evt_mock_${Math.random().toString(36).substring(2, 10)}`,
        type: 'payment_intent.succeeded',
        data: { object: pi },
        created: Math.floor(Date.now() / 1000),
      });

      return pi;
    },

    retrieve: async (id: string): Promise<MockPaymentIntent> => {
      const pi = this.paymentIntentsStore.get(id);
      if (!pi) {
        throw new Error(`StripeError: No such payment_intent: '${id}'`);
      }
      return pi;
    },

    cancel: async (id: string): Promise<MockPaymentIntent> => {
      const pi = this.paymentIntentsStore.get(id);
      if (!pi) {
        throw new Error(`StripeError: No such payment_intent: '${id}'`);
      }
      pi.status = 'canceled';
      return pi;
    },
  };

  /**
   * Transfers API simulation (Separate Charges and Transfers)
   */
  public transfers = {
    create: async (
      params: CreateTransferParams,
      options?: RequestOptions
    ): Promise<MockTransfer> => {
      if (options?.idempotencyKey && this.idempotencyKeys.has(options.idempotencyKey)) {
        return this.idempotencyKeys.get(options.idempotencyKey);
      }

      if (params.amount <= 0) {
        throw new Error(`StripeError: Transfer amount must be positive, got ${params.amount}`);
      }

      if (!params.destination || !params.destination.startsWith('acct_')) {
        throw new Error(`StripeError: Invalid destination account ID '${params.destination}'`);
      }

      const id = `tr_mock_${Math.random().toString(36).substring(2, 12)}_${Date.now()}`;
      const transfer: MockTransfer = {
        id,
        amount: params.amount,
        currency: params.currency.toLowerCase(),
        destination: params.destination,
        transfer_group: params.transfer_group,
        metadata: params.metadata || {},
        created: Math.floor(Date.now() / 1000),
      };

      this.transfersStore.set(id, transfer);

      if (options?.idempotencyKey) {
        this.idempotencyKeys.set(options.idempotencyKey, transfer);
      }

      return transfer;
    },

    list: async (filter?: {
      transfer_group?: string;
      destination?: string;
    }): Promise<MockTransfer[]> => {
      let results = Array.from(this.transfersStore.values());
      if (filter?.transfer_group) {
        results = results.filter((t) => t.transfer_group === filter.transfer_group);
      }
      if (filter?.destination) {
        results = results.filter((t) => t.destination === filter.destination);
      }
      return results;
    },
  };

  /**
   * Refunds API simulation
   */
  public refunds = {
    create: async (
      params: CreateRefundParams,
      options?: RequestOptions
    ): Promise<MockRefund> => {
      if (options?.idempotencyKey && this.idempotencyKeys.has(options.idempotencyKey)) {
        return this.idempotencyKeys.get(options.idempotencyKey);
      }

      const pi = this.paymentIntentsStore.get(params.payment_intent);
      if (!pi) {
        throw new Error(`StripeError: No such payment_intent: '${params.payment_intent}'`);
      }

      const refundAmount = params.amount ?? pi.amount;
      if (refundAmount > pi.amount) {
        throw new Error(`StripeError: Refund amount cannot exceed payment intent amount`);
      }

      const id = `re_mock_${Math.random().toString(36).substring(2, 12)}_${Date.now()}`;
      const refund: MockRefund = {
        id,
        payment_intent: params.payment_intent,
        amount: refundAmount,
        status: 'succeeded',
        created: Math.floor(Date.now() / 1000),
      };

      this.refundsStore.set(id, refund);
      pi.status = 'canceled';

      if (options?.idempotencyKey) {
        this.idempotencyKeys.set(options.idempotencyKey, refund);
      }

      await this.webhooks.dispatch({
        id: `evt_mock_${Math.random().toString(36).substring(2, 10)}`,
        type: 'charge.refunded',
        data: { object: refund },
        created: Math.floor(Date.now() / 1000),
      });

      return refund;
    },
  };

  /**
   * Webhook API simulation
   */
  public webhooks = {
    constructEvent: (
      payload: string | any,
      signature: string,
      secret: string
    ): StripeWebhookEvent => {
      if (!secret || secret.trim() === '') {
        throw new Error('StripeSignatureVerificationError: Missing webhook secret');
      }
      if (!signature || !signature.startsWith('t=')) {
        throw new Error('StripeSignatureVerificationError: Invalid or missing webhook signature');
      }

      const event = typeof payload === 'string' ? JSON.parse(payload) : payload;
      return event as StripeWebhookEvent;
    },

    on: (eventType: string, handler: (event: StripeWebhookEvent) => Promise<void> | void) => {
      const existing = this.webhookListeners.get(eventType) || [];
      existing.push(handler);
      this.webhookListeners.set(eventType, existing);
    },

    dispatch: async (event: StripeWebhookEvent): Promise<void> => {
      const handlers = this.webhookListeners.get(event.type) || [];
      const wildcardHandlers = this.webhookListeners.get('*') || [];
      const allHandlers = [...handlers, ...wildcardHandlers];

      for (const handler of allHandlers) {
        await handler(event);
      }
    },
  };

  /**
   * Inspect escrow balance for a specific booking transfer_group
   */
  public getEscrowHold(bookingId: string): {
    paymentIntent?: MockPaymentIntent;
    transfers: MockTransfer[];
    refunds: MockRefund[];
    isEscrowHeld: boolean;
    isFullyDisbursed: boolean;
  } {
    const transferGroup = `booking_${bookingId}`;
    const pi = Array.from(this.paymentIntentsStore.values()).find(
      (p) => p.transfer_group === transferGroup
    );
    const transfers = Array.from(this.transfersStore.values()).filter(
      (t) => t.transfer_group === transferGroup
    );
    const refunds = Array.from(this.refundsStore.values()).filter(
      (r) => r.payment_intent === pi?.id
    );

    const isEscrowHeld = pi?.status === 'succeeded' && transfers.length === 0 && refunds.length === 0;
    const totalTransferred = transfers.reduce((sum, t) => sum + t.amount, 0);
    const isFullyDisbursed = transfers.length >= 2 && totalTransferred > 0;

    return {
      paymentIntent: pi,
      transfers,
      refunds,
      isEscrowHeld,
      isFullyDisbursed,
    };
  }

  /**
   * Clear all stored mock records
   */
  public reset(): void {
    this.paymentIntentsStore.clear();
    this.transfersStore.clear();
    this.refundsStore.clear();
    this.idempotencyKeys.clear();
    this.webhookListeners.clear();
  }
}

// Global singleton instance for shared mock usage across app & tests
export const mockStripe = new MockStripeService();
