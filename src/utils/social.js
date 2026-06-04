'use strict';

const axios = require('axios');

const WARPCAST_API  = 'https://api.warpcast.com/v2';
const FARCASTER_HUB = 'https://hub.pinata.cloud/v1';
const PARAGRAPH_API = 'https://paragraph.xyz/api';

// ── Farcaster ─────────────────────────────────────────────────────────────────

async function _warpcastUser(address) {
  try {
    const r = await axios.get(`${WARPCAST_API}/user-by-verification`, {
      params: { address: address.toLowerCase() },
      timeout: 8000,
    });
    return r.data?.result?.user || null;
  } catch { return null; }
}

async function _hubCasts(fid, limit = 12) {
  try {
    const r = await axios.get(`${FARCASTER_HUB}/castsByFid`, {
      params: { fid, pageSize: limit, reverse: 1 },
      timeout: 10000,
    });
    return r.data?.messages || [];
  } catch { return []; }
}

async function _warpcastRecentCasts(fid, limit = 12) {
  try {
    const r = await axios.get(`${WARPCAST_API}/casts`, {
      params: { fid, limit },
      timeout: 10000,
    });
    return r.data?.result?.casts || [];
  } catch { return []; }
}

async function _warpcastFollowing(fid) {
  try {
    const r = await axios.get(`${WARPCAST_API}/following`, {
      params: { fid, limit: 8 },
      timeout: 8000,
    });
    return (r.data?.result?.users || []).map(u => u.username).filter(Boolean);
  } catch { return []; }
}

/**
 * Fetch Farcaster social data for an EVM address.
 * Returns null if the address has no Farcaster account.
 */
async function getFarcasterData(address) {
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return null;

  const user = await _warpcastUser(address);
  if (!user?.fid) return null;

  const fid = user.fid;

  // Fetch casts + following in parallel
  const [rawCasts, following] = await Promise.all([
    _warpcastRecentCasts(fid).then(c => c.length ? c : _hubCasts(fid)),
    _warpcastFollowing(fid),
  ]);

  // Normalise casts from either API format
  const casts = rawCasts.slice(0, 12).map(c => {
    const text     = c.text || c.data?.castAddBody?.text || '';
    const likes    = c.reactions?.count   || c.data?.castAddBody?.embeds?.length || 0;
    const replies  = c.replies?.count     || 0;
    const recasts  = c.recasts?.count     || 0;
    const ts       = c.timestamp          || c.data?.timestamp || null;
    return { text, likes, replies, recasts, ts };
  }).filter(c => c.text.length > 2);

  return {
    fid,
    username:       user.username         || '',
    displayName:    user.displayName      || user.username || '',
    bio:            user.profile?.bio?.text || '',
    followerCount:  user.followerCount    || 0,
    followingCount: user.followingCount   || 0,
    casts,
    following,
  };
}

// ── Paragraph ─────────────────────────────────────────────────────────────────

async function _tryParagraphBlogs(params) {
  try {
    const r = await axios.get(`${PARAGRAPH_API}/blogs`, { params, timeout: 8000 });
    const list = Array.isArray(r.data) ? r.data : (r.data?.blogs || r.data?.data || []);
    return list;
  } catch { return []; }
}

async function _paragraphPosts(blogId) {
  try {
    const r = await axios.get(`${PARAGRAPH_API}/blogs/${blogId}/posts`, {
      params: { limit: 6 },
      timeout: 8000,
    });
    const list = Array.isArray(r.data) ? r.data : (r.data?.posts || []);
    return list.slice(0, 6).map(p => ({
      title:       p.title       || '',
      subtitle:    p.subtitle    || '',
      publishedAt: p.publishedAt || p.created_at || '',
    }));
  } catch { return []; }
}

/**
 * Fetch Paragraph blog data for an EVM address.
 * Returns null if the address has no Paragraph blog.
 */
async function getParagraphData(address) {
  if (!address) return null;
  const addr = address.toLowerCase();

  // Try several lookup strategies
  let blogs = await _tryParagraphBlogs({ address: addr });
  if (!blogs.length) blogs = await _tryParagraphBlogs({ walletAddress: addr });
  if (!blogs.length) return null;

  const blog  = blogs[0];
  const posts = blog.id ? await _paragraphPosts(blog.id) : [];

  return {
    blogId:          blog.id              || null,
    title:           blog.title           || blog.name        || '',
    description:     blog.description     || blog.subtitle    || '',
    subscriberCount: blog.subscriberCount || blog.subscriber_count || 0,
    postCount:       blog.postCount       || blog.post_count  || posts.length,
    posts,
  };
}

module.exports = { getFarcasterData, getParagraphData };
