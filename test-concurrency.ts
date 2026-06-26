import * as process from 'process';

async function triggerWebhook(commitId: string) {
  const url = 'https://52.172.229.65.nip.io/v1/deployments/webhook/github';
  const payload = {
    repository: { full_name: 'octocat/Spoon-Knife' },
    ref: 'refs/heads/main',
    head_commit: { 
      id: commitId, 
      message: `Test concurrency commit ${commitId}`, 
      author: { name: 'Test-Bot' } 
    }
  };

  try {
    // Note: process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0' could be used to bypass self-signed certs locally
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    
    const data = await res.json();
    if (res.ok) {
      console.log(`✅ Webhook triggered for ${commitId}:`, data);
    } else {
      console.error(`❌ Webhook failed for ${commitId}:`, data);
    }
  } catch (err: any) {
    console.error(`❌ Webhook failed for ${commitId}:`, err.message);
  }
}

async function run() {
  console.log('🚀 Triggering 3 simultaneous builds to test the Build Queue...');
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // Bypass local cert warnings for nip.io
  
  // Use a valid commit SHA so the download succeeds!
  const validSha = 'd0dd1f61b33d64e29d8bc1372a94ef6a2fee76a9';

  // Fire 3 requests in parallel
  await Promise.all([
    triggerWebhook(validSha),
    triggerWebhook(validSha),
    triggerWebhook(validSha)
  ]);

  console.log('🕒 All 3 webhook requests sent! Check the VM logs (pm2 logs cc-backend) to see them queue up!');
}

run();
