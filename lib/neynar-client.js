const NEYNAR_BASE_URL = 'https://api.neynar.com/v2/farcaster';

export async function fetchChannelCasts({ apiKey, channel, limit }) {
  const url = new URL(`${NEYNAR_BASE_URL}/feed/channels`);
  url.searchParams.set('channel_ids', channel);
  url.searchParams.set('with_recasts', 'false');
  url.searchParams.set('limit', String(limit));

  const resp = await fetch(url, {
    headers: {
      'x-api-key': apiKey
    }
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Failed to fetch casts (${resp.status}): ${body}`);
  }

  const data = await resp.json();
  return data.casts || [];
}

export async function publishCast({ apiKey, signerUuid, text, channel, parentHash }) {
  const payload = {
    signer_uuid: signerUuid,
    text,
    channel_id: channel
  };

  if (parentHash) {
    payload.parent = parentHash;
  }

  const resp = await fetch(`${NEYNAR_BASE_URL}/cast`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey
    },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Neynar rejected the cast (${resp.status}): ${body}`);
  }

  return resp.json();
}
