/**
 * Custom x402 payment gate that settles BEFORE calling next().
 * x402-express buffers all response writes until settle() completes, which breaks SSE.
 * This gate: verify -> settle -> set header -> next() with no buffering.
 */
import type { Request, Response, NextFunction } from 'express';
import { getAddress } from 'viem';
import * as schemes from 'x402/schemes';
import {
  computeRoutePatterns,
  findMatchingRoute,
  processPriceToAtomicAmount,
  findMatchingPaymentRequirements,
  toJsonSafe,
} from 'x402/shared';
import { useFacilitator } from 'x402/verify';
import { SupportedEVMNetworks, settleResponseHeader } from 'x402/types';

const x402Version = 1;

export interface StreamingGateConfig {
  payTo: `0x${string}`;
  routes: Record<string, unknown>;
  facilitator?: { url: string };
}

export function createStreamingPaymentGate(config: StreamingGateConfig) {
  const { verify, settle } = useFacilitator(config.facilitator as { url: `${string}://${string}` });
  const routePatterns = computeRoutePatterns(config.routes as Parameters<typeof computeRoutePatterns>[0]);

  return async function streamingPaymentGate(req: Request, res: Response, next: NextFunction) {
    const matchingRoute = findMatchingRoute(routePatterns, req.path, req.method.toUpperCase());
    if (!matchingRoute) return next();

    const { price, network, config: routeConfig = {} } = matchingRoute.config;
    const {
      description = '',
      mimeType = '',
      maxTimeoutSeconds = 60,
      resource,
    } = routeConfig as { description?: string; mimeType?: string; maxTimeoutSeconds?: number; resource?: string };

    const atomicAmountForAsset = processPriceToAtomicAmount(price, network);
    if ('error' in atomicAmountForAsset) {
      throw new Error(atomicAmountForAsset.error);
    }
    const { maxAmountRequired, asset } = atomicAmountForAsset;
    const resourceUrl = resource || `${req.protocol}://${req.headers.host}${req.path}`;

    const paymentRequirements =
      SupportedEVMNetworks.includes(network as (typeof SupportedEVMNetworks)[number])
        ? [
            {
              scheme: 'exact' as const,
              network,
              maxAmountRequired,
              resource: resourceUrl,
              description,
              mimeType,
              payTo: getAddress(config.payTo),
              maxTimeoutSeconds,
              asset: getAddress(asset.address),
              outputSchema: {
                input: { type: 'http' as const, method: req.method.toUpperCase(), discoverable: true },
              },
              extra: 'eip712' in asset ? asset.eip712 : undefined,
            },
          ]
        : [];

    const payment = req.header('X-PAYMENT');
    if (!payment) {
      res.status(402).json({
        x402Version,
        error: 'X-PAYMENT header is required',
        accepts: toJsonSafe(paymentRequirements),
      });
      return;
    }

    let decodedPayment: unknown;
    try {
      decodedPayment = schemes.exact.evm.decodePayment(payment);
      (decodedPayment as Record<string, number>).x402Version = x402Version;
    } catch {
      res.status(402).json({
        x402Version,
        error: 'Invalid or malformed payment header',
        accepts: toJsonSafe(paymentRequirements),
      });
      return;
    }

    const selectedPaymentRequirements = findMatchingPaymentRequirements(
      paymentRequirements,
      decodedPayment as Parameters<typeof findMatchingPaymentRequirements>[1]
    );
    if (!selectedPaymentRequirements) {
      res.status(402).json({
        x402Version,
        error: 'Unable to find matching payment requirements',
        accepts: toJsonSafe(paymentRequirements),
      });
      return;
    }

    try {
      const verifyResponse = await verify(
        decodedPayment as Parameters<typeof verify>[0],
        selectedPaymentRequirements
      );
      if (!verifyResponse.isValid) {
        res.status(402).json({
          x402Version,
          error: verifyResponse.invalidReason,
          accepts: toJsonSafe(paymentRequirements),
          payer: verifyResponse.payer,
        });
        return;
      }
    } catch (err) {
      console.error('[x402] Verify failed:', err);
      res.status(402).json({
        x402Version,
        error: err instanceof Error ? err.message : 'Payment verification failed',
        accepts: toJsonSafe(paymentRequirements),
      });
      return;
    }

    try {
      const settleResponse = await settle(
        decodedPayment as Parameters<typeof settle>[0],
        selectedPaymentRequirements
      );
      const responseHeader = settleResponseHeader(settleResponse);
      if (!settleResponse.success) {
        res.status(402).json({
          x402Version,
          error: settleResponse.errorReason,
          accepts: toJsonSafe(paymentRequirements),
        });
        return;
      }
      res.setHeader('X-PAYMENT-RESPONSE', responseHeader);
    } catch (err) {
      console.error('[x402] Settle failed:', err);
      res.status(402).json({
        x402Version,
        error: err instanceof Error ? err.message : 'Payment settlement failed',
        accepts: toJsonSafe(paymentRequirements),
      });
      return;
    }

    next();
  };
}
