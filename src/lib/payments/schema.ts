import { z } from "zod";

export const initPaymentResponseSchema = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9]{8,512}$/),
    iframeUrl: z.string().regex(/^https:\/\/www\.paytr\.com\/odeme\/guvenli\/[A-Za-z0-9]{8,512}$/),
  })
  .strict();
