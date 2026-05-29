export default async function handler(req, res) {
  // Extract query parameters
  // Supporting both URL object query parameters (like in standard Node.js server) and Vercel's req.query
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const platform = req.query?.platform || url.searchParams.get('platform');
  const username = req.query?.username || url.searchParams.get('username');

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (!platform || !username) {
    res.status(400).json({ error: 'Missing platform or username parameter.' });
    return;
  }

  try {
    if (platform === 'leetcode') {
      const query = `
        query getUserProfile($username: String!) {
          matchedUser(username: $username) {
            username
            submissionCalendar
            submitStats: submitStatsGlobal {
              acSubmissionNum {
                difficulty
                count
                submissions
              }
            }
          }
        }
      `;

      const response = await fetch('https://leetcode.com/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
          'Referer': 'https://leetcode.com'
        },
        body: JSON.stringify({
          query,
          variables: { username }
        })
      });

      if (!response.ok) {
        res.status(response.status).json({ error: `LeetCode API responded with status ${response.status}` });
        return;
      }

      const result = await response.json();
      if (result.errors) {
        res.status(400).json({ error: result.errors[0]?.message || 'LeetCode GraphQL error' });
        return;
      }

      if (!result.data || !result.data.matchedUser) {
        res.status(404).json({ error: `LeetCode user '${username}' not found.` });
        return;
      }

      res.status(200).json(result.data.matchedUser);
    } else if (platform === 'codeforces') {
      const [infoRes, statusRes] = await Promise.all([
        fetch(`https://codeforces.com/api/user.info?handles=${username}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
          }
        }),
        fetch(`https://codeforces.com/api/user.status?handle=${username}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
          }
        })
      ]);

      const infoJson = await infoRes.json();
      const statusJson = await statusRes.json();

      if (infoJson.status === 'FAILED') {
        res.status(404).json({ error: infoJson.comment || `Codeforces user '${username}' not found.` });
        return;
      }

      if (statusJson.status === 'FAILED') {
        res.status(404).json({ error: statusJson.comment || `Codeforces status fetch failed for user '${username}'.` });
        return;
      }

      const mergedData = {
        info: infoJson.result[0],
        status: statusJson.result
      };

      res.status(200).json(mergedData);
    } else {
      res.status(400).json({ error: `Unsupported platform '${platform}'.` });
    }
  } catch (error) {
    res.status(500).json({ error: 'Serverless proxy error', details: error.message });
  }
}
