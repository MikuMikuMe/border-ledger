const assetLinksBody = process.env.ANDROID_ACCEPTANCE_ASSET_LINKS_BODY;

if (!assetLinksBody) {
  throw new Error('ANDROID_ACCEPTANCE_ASSET_LINKS_BODY is required');
}

globalThis.fetch = async () => new Response(assetLinksBody, {
  status: 200,
  headers: { 'content-type': 'application/json' },
});
