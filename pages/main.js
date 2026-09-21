const logger = document.getElementById("logger");
const copy = document.getElementById("copy");
const output = document.getElementById("output");

function getDays(dateStr) {
  const date = new Date(dateStr);
  const diff = Date.now() - date.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function copyOutputToClipboard() {
  const clipboardItem = new ClipboardItem({
    "text/plain": new Blob([output.textContent], { type: "text/plain" }),
    "text/html": new Blob([output.innerHTML], { type: "text/html" }),
  });
  navigator.clipboard.write([clipboardItem]);
  logger.innerHTML += "<p>copied</p>";
}
copy.addEventListener("click", copyOutputToClipboard);

function formatPRList(name, list, note = "") {
  if (list.length === 0) return "";
  return `
<br>
<p><strong>${name}</strong> (${list.length})${
    note ? ` · <em>${note}</em>` : ""
  }</p>
<ul>
${
    list.map((pr) =>
      `<li><a href="${pr.url}">${pr.name}</a> · ${pr.daysOpen}d · <code>+${pr.additions},-${pr.deletions}</code></li>`
    ).join("")
  }
</ul>
  `;
}

async function onSubmit(e) {
  e.preventDefault();
  logger.innerHTML = "";
  output.innerHTML = "";
  const formData = new FormData(e.target, e.submitter);

  const GITHUB_TOKEN = formData.get("token");
  const repos = formData.get("repos").split("\n").filter((r) =>
    r.includes("/")
  );

  const repoQuery = repos.map((r) => "repo:" + r).join(" ");

  // https://docs.github.com/en/graphql/reference/search
  // https://docs.github.com/en/graphql/reference/repos#object-repository
  const query = `
query {
  search(type: REPOSITORY, query: "${repoQuery}", first: 5) {
    nodes {
      ... on Repository {
        pullRequests(first: 100, states:OPEN) {
          edges {
            node {
              additions
              deletions
              labels(first: 10) {
                edges {
                  node {
                    name
                  }
                }
              }
              isDraft
              permalink
              publishedAt
              reviewDecision
              reviews(first:30) {
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
  }
}
`;

  logger.innerHTML += "<p>Fetching pull requests from Github...</p>";
  const res = await fetch("https://api.github.com/graphql", {
    method: "post",
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}` },
    body: JSON.stringify({ query }),
  });
  const body = await res.json();

  if (!res.ok || body.errors) {
    logger.innerHTML += `<p style="color:red">${
      JSON.stringify(body, null, 2)
    }</p>`;
    return;
  }

  logger.innerHTML += "<p>Formatting response...</p>";
  const pullRequests = [];
  for (const repo of body.data.search.nodes) {
    for ({ node } of repo.pullRequests.edges) {
      if (node.isDraft || node.title.startsWith("[release candidate]")) {
        continue;
      }
      pullRequests.push(node);
    }
  }

  const initialGroups = {
    ready: [],
    urgent: [],
    partial: [],
    deleting: [],
    small: [],
    remaining: [],
    external: [],
    stale: [],
  };

  const groups = pullRequests.reduce((acc, val) => {
    let group;
    const additions = val.additions;
    const deletions = val.deletions;

    if (getDays(val.updatedAt) > 7 * 3 || getDays(val.publishedAt) > 7 * 4) {
      group = "stale";
    } else if (val.reviewDecision === "APPROVED") {
      group = "ready";
    } else if (
      val.labels.edges.some(({ node }) => node.name.toLowerCase() === "urgent")
    ) {
      group = "urgent";
    } else if (
      val.labels.edges.some(({ node }) =>
        node.name.toLowerCase() === "external"
      )
    ) {
      group = "external";
    } else if (
      val.reviews.edges.some((edge) => edge.node.state === "APPROVED")
    ) {
      group = "partial";
    } else if (deletions - additions > 50) {
      group = "deleting";
    } else if (additions < 100 && deletions < 200) {
      group = "small";
    } else {
      group = "remaining";
    }

    acc[group].push({
      name: val.title,
      url: val.permalink,
      daysOpen: getDays(val.publishedAt),
      additions: val.additions,
      deletions: val.deletions,
    });
    return acc;
  }, initialGroups);

  const totalNum = Object.values(groups).reduce(
    (acc, val) => acc + val.length,
    0,
  );

  output.innerHTML = `
<p><strong>Pull Request Summary for ${
    repos.map((r) => `<code>${r}</code>`).join(",")
  } (${totalNum} open)</strong></p>
`;

  output.innerHTML += formatPRList(
    "Ready to Merge",
    groups.ready,
    "what are we waiting for?",
  );
  output.innerHTML += formatPRList("Urgent!", groups.urgent);
  output.innerHTML += formatPRList("Partially Approved", groups.partial);
  output.innerHTML += formatPRList("Deleting Code", groups.deleting);
  output.innerHTML += formatPRList("Small Changes", groups.small);
  output.innerHTML += formatPRList("Remaining", groups.remaining);
  output.innerHTML += formatPRList("External", groups.external);
  output.innerHTML += formatPRList(
    "Old or Stale",
    groups.stale,
    "please close these if they are no longer relevant",
  );
  output.innerHTML +=
    `<br><blockquote><em>This summary was <a href="https://github.com/bossley9/pr-summary-generator">generated by a human</a>. Check for mistakes.</em></blockquote>`;

  logger.innerHTML += "<p>Below is an output preview.</p>";
}
document.querySelector("form").addEventListener("submit", onSubmit);
