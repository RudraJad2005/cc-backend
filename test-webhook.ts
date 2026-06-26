async function testWebhook() {
  const repo = 'octocat/Spoon-Knife';
  
  console.log(`Fetching latest commit from GitHub for: ${repo}...`);
  
  try {
    const commitRes = await fetch(`https://api.github.com/repos/${repo}/commits`, {
      headers: { 'User-Agent': 'CollabCode-Test-Agent' }
    });
    
    if (!commitRes.ok) {
      console.error(`Failed to fetch commits: ${commitRes.statusText} (${commitRes.status})`);
      return;
    }
    
    const commits = await commitRes.json() as any[];
    if (commits.length === 0) {
      console.error('No commits found in the repository.');
      return;
    }
    
    const latestCommit = commits[0];
    const commitSha = latestCommit.sha;
    const commitMsg = latestCommit.commit.message;
    const commitAuthor = latestCommit.commit.author.name;
    
    console.log(`Latest commit found: ${commitSha} - "${commitMsg}" by ${commitAuthor}`);

    const url = 'https://52.172.229.65.nip.io/v1/deployments/webhook/github';
    const payload = {
      ref: 'refs/heads/master',
      repository: {
        full_name: repo
      },
      head_commit: {
        id: commitSha,
        message: commitMsg,
        author: {
          name: commitAuthor
        }
      }
    };

    console.log(`Sending mock GitHub webhook payload to: ${url}`);
    console.log(`Repository: ${payload.repository.full_name}`);
    console.log(`Commit SHA: ${payload.head_commit.id}`);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'GitHub-Hookshot/test'
      },
      body: JSON.stringify(payload)
    });

    const status = res.status;
    const bodyText = await res.text();
    console.log(`Response Status: ${status}`);
    console.log(`Response Body:\n${bodyText}`);
  } catch (err: any) {
    console.error('Error in test script:', err.message);
  }
}

testWebhook();
