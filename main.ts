import process from "node:process";
import { spawn } from "node:child_process";

const [owner, repo] = process.argv[2].split("/") ?? [];
if (!owner || !repo) {
  console.error("usage: npm start -- owner/repo");
  process.exit(1);
}

const { GITHUB_TOKEN } = process.env;
if (!GITHUB_TOKEN) {
  console.error("error: env var GITHUB_TOKEN must be a valid Github token with `repo` privileges");
  process.exit(1);
}

type Data = {
  repository: {
    pullRequests: {
      edges: {
        node: {
          files: {
            edges: { node: { additions: number; deletions: number } }[];
          };
          isDraft: boolean;
          permalink: string;
          publishedAt: string;
          reviewDecision: "APPROVED" | "" | null;
          reviews: {
            edges: { node: { state: "APPROVED" | "" } }[];
          };
          title: string;
          updatedAt: string;
        };
      }[];
    };
  };
};

// https://docs.github.com/en/graphql/reference/repos#object-repository
const query = `
query {
  repository(owner: "${owner}", name: "${repo}") {
    pullRequests(first: 100, states:OPEN) {
      edges {
        node {
          files(first:40) {
            edges {
              node {
                additions
                deletions
              }
            }
          }
          isDraft
          permalink
          publishedAt
          reviewDecision
          reviews(first:5) {
            edges {
              node {
                state
              }
            }
          }
          title
          updatedAt
        }
      }
    }
  }
}
`;

console.log("fetching data from Github...");
const res = await fetch("https://api.github.com/graphql", {
  method: "post",
  headers: { Authorization: `Bearer ${GITHUB_TOKEN}` },
  body: JSON.stringify({ query }),
});

if (!res.ok) {
  console.error(res.body);
  process.exit(1);
}

const body = await res.json();

if (body.errors) {
  console.error(body.errors);
  process.exit(1);
}

const data: Data = body.data;

console.log("Formatting response to rich text...");
const pullRequests = data.repository.pullRequests.edges.flatMap(({ node }) =>
  node.isDraft || node.title.startsWith("[release candidate]") ? [] : [node],
);

type PR = { name: string; url: string; daysOpen: number };

const initialGroups = {
  ready: [] as PR[],
  partial: [] as PR[],
  deleting: [] as PR[],
  small: [] as PR[],
  remaining: [] as PR[],
  stale: [] as PR[],
};

const now = Date.now();

function getDays(dateStr: string): number {
  const date = new Date(dateStr);
  const diff = now - date.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

const groups = pullRequests.reduce((acc, val) => {
  let group: keyof typeof initialGroups | undefined;
  let additions = 0;
  let deletions = 0;

  for (const file of val.files.edges) {
    additions += file.node.additions;
    deletions += file.node.deletions;
  }

  if (getDays(val.updatedAt) > 7 * 3) {
    group = "stale";
  } else if (val.reviewDecision === "APPROVED") {
    group = "ready";
  } else if (val.reviews.edges.some((edge) => edge.node.state === "APPROVED")) {
    group = "partial";
  } else if (additions < 120 && deletions < 120) {
    group = "small";
  } else if (deletions - additions > 50) {
    group = "deleting";
  } else {
    group = "remaining";
  }

  acc[group].push({
    name: val.title,
    url: val.permalink,
    daysOpen: getDays(val.publishedAt),
  });
  return acc;
}, initialGroups);

const totalNum = Object.values(groups).reduce((acc, val) => acc + val.length, 0);

function copyToClipboard(str: string) {
  let cmd: string | undefined;
  switch (process.platform) {
    case "darwin":
      cmd = "pbcopy";
    default:
      cmd = "wl-copy";
  }
  const p = spawn(cmd, ["-t", "text/html"]);
  p.stdin.write(str);
  p.stdin.end();
}

function formatPRList(pullRequests: PR[]) {
  return (
    "<ul>" +
    pullRequests
      .map((pr) => `<li><a href="${pr.url}">${pr.name}</a> · ${pr.daysOpen}d</li>`)
      .join("") +
    "</ul>"
  );
}

const message = `
<p><strong>Pull Request Summary for <code>${owner}/${repo}</code> (${totalNum} open)</strong></p>
<br>
<p><strong>Ready to Merge</strong> (${groups.ready.length})</p>
${formatPRList(groups.ready)}
<br>
<p><strong>Partially Approved</strong> (${groups.partial.length})</p>
${formatPRList(groups.partial)}
<br>
<p><strong>Deleting Code</strong> (${groups.deleting.length})</p>
${formatPRList(groups.deleting)}
<br>
<p><strong>Small Changes</strong> (${groups.small.length})</p>
${formatPRList(groups.small)}
<br>
<p><strong>Remaining</strong> (${groups.remaining.length})</p>
${formatPRList(groups.remaining)}
<br>
<p><strong>Stale</strong> (${groups.stale.length})</p>
<br>
${formatPRList(groups.stale)}
`;

console.log("Writing rich text to clipboard...");
copyToClipboard(message);

console.log("Done.");
process.exit(0);
