import {
  type ChannelPermission,
  type PaymentPermission,
  type Permission,
  type PermissionRequest,
  PermissionUrlError,
  parsePermissionUrl,
  shannonsToCkb,
  toHex,
} from '@fiber-pay/sdk';
import { printJsonError, printJsonSuccess } from './format.js';

interface ReviewOptions {
  json?: boolean;
}

function isPaymentPermission(permission: Permission): permission is PaymentPermission {
  return permission.resource === 'payments' && permission.action === 'write';
}

function isChannelPermission(permission: Permission): permission is ChannelPermission {
  return permission.resource === 'channels' && permission.action === 'write';
}

function formatPermission(permission: Permission): Record<string, unknown> {
  const base = {
    resource: permission.resource,
    action: permission.action,
  };

  if (isPaymentPermission(permission)) {
    return {
      ...base,
      limits: {
        ...(permission.max_amount !== undefined && {
          maxAmountCkb: shannonsToCkb(toHex(permission.max_amount)),
        }),
        ...(permission.daily_limit !== undefined && {
          dailyLimitCkb: shannonsToCkb(toHex(permission.daily_limit)),
        }),
        ...(permission.daily_count_limit !== undefined && {
          dailyCountLimit: permission.daily_count_limit,
        }),
        ...(permission.hourly_count_limit !== undefined && {
          hourlyCountLimit: permission.hourly_count_limit,
        }),
        ...(permission.min_interval_seconds !== undefined && {
          minIntervalSeconds: permission.min_interval_seconds,
        }),
        ...(permission.allowed_recipients !== undefined && {
          allowedRecipients: permission.allowed_recipients,
        }),
      },
    };
  }

  if (isChannelPermission(permission)) {
    return {
      ...base,
      limits: {
        ...(permission.can_create_new !== undefined && {
          canCreateNew: permission.can_create_new,
        }),
        ...(permission.max_funding !== undefined && {
          maxFundingCkb: shannonsToCkb(toHex(permission.max_funding)),
        }),
        ...(permission.allowed_channels !== undefined && {
          allowedChannels: permission.allowed_channels,
        }),
        ...(permission.can_close !== undefined && { canClose: permission.can_close }),
        ...(permission.can_force_close !== undefined && {
          canForceClose: permission.can_force_close,
        }),
      },
    };
  }

  return base;
}

function formatPermissionForDisplay(permission: Permission): string {
  let output = `  - ${permission.resource}:${permission.action}`;

  if (isPaymentPermission(permission)) {
    const limits: string[] = [];
    if (permission.max_amount !== undefined) {
      limits.push(`max ${shannonsToCkb(toHex(permission.max_amount))} CKB/payment`);
    }
    if (permission.daily_limit !== undefined) {
      limits.push(`daily limit ${shannonsToCkb(toHex(permission.daily_limit))} CKB`);
    }
    if (permission.daily_count_limit !== undefined) {
      limits.push(`${permission.daily_count_limit}/day`);
    }
    if (permission.hourly_count_limit !== undefined) {
      limits.push(`${permission.hourly_count_limit}/hour`);
    }
    if (permission.min_interval_seconds !== undefined) {
      limits.push(`min interval ${permission.min_interval_seconds}s`);
    }
    if (permission.allowed_recipients !== undefined) {
      limits.push(`recipients: ${permission.allowed_recipients.join(', ')}`);
    }
    if (limits.length > 0) {
      output += ` (${limits.join(', ')})`;
    }
  }

  if (isChannelPermission(permission)) {
    const limits: string[] = [];
    if (permission.can_create_new) {
      limits.push('can create');
    }
    if (permission.max_funding !== undefined) {
      limits.push(`max funding ${shannonsToCkb(toHex(permission.max_funding))} CKB`);
    }
    if (permission.can_close) {
      limits.push('can close');
    }
    if (permission.can_force_close) {
      limits.push('can force-close');
    }
    if (permission.allowed_channels !== undefined) {
      limits.push(`channels: ${permission.allowed_channels.join(', ')}`);
    }
    if (limits.length > 0) {
      output += ` (${limits.join(', ')})`;
    }
  }

  return output;
}

function formatReviewData(request: PermissionRequest): Record<string, unknown> {
  return {
    app: {
      id: request.app.id,
      name: request.app.name,
      ...(request.app.icon && { icon: request.app.icon }),
      ...(request.app.callback_url && { callbackUrl: request.app.callback_url }),
    },
    permissions: request.permissions.map(formatPermission),
    expiresIn: request.expires_in,
    nonce: request.nonce,
    ...(request.signature && { signature: request.signature }),
  };
}

function printReviewHuman(request: PermissionRequest): void {
  console.log('Permission Request');
  console.log('');
  console.log(`App:         ${request.app.name}`);
  console.log(`App ID:      ${request.app.id}`);
  if (request.app.icon) {
    console.log(`Icon:        ${request.app.icon}`);
  }
  if (request.app.callback_url) {
    console.log(`Callback:    ${request.app.callback_url}`);
  }
  console.log('');
  console.log('Requested Permissions:');
  for (const permission of request.permissions) {
    console.log(formatPermissionForDisplay(permission));
  }
  console.log('');
  console.log(`Expiration:  ${request.expires_in}`);
  console.log(`Nonce:       ${request.nonce}`);
  if (request.signature) {
    console.log(`Signature:   ${request.signature.slice(0, 32)}...`);
  }
}

export async function runPermissionsReviewCommand(
  url: string,
  options: ReviewOptions,
): Promise<void> {
  try {
    const request = parsePermissionUrl(url);

    if (options.json) {
      printJsonSuccess(formatReviewData(request));
    } else {
      printReviewHuman(request);
    }
  } catch (error) {
    if (error instanceof PermissionUrlError) {
      if (options.json) {
        printJsonError({
          code: `PERMISSION_URL_${error.code}`,
          message: error.message,
        });
      } else {
        console.error(`Error: ${error.message}`);
      }
      process.exit(1);
    }

    throw error;
  }
}
