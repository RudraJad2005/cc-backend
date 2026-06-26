import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { handleBuild } from '../utils/build';
import { supabase } from '../utils/supabase';

const router = Router();

// --- BUILD QUEUE SYSTEM ---
interface QueueTask {
  deploymentId: string;
  run: () => Promise<void>;
}

const buildQueue: QueueTask[] = [];
let activeBuildsCount = 0;
const MAX_CONCURRENT_BUILDS = 1;

function queueBuild(deploymentId: string, run: () => Promise<void>) {
  buildQueue.push({ deploymentId, run });
  console.log(`[Queue] Added deployment ${deploymentId} to build queue. Position: ${buildQueue.length}`);
  processQueue();
}

async function processQueue() {
  if (activeBuildsCount >= MAX_CONCURRENT_BUILDS) {
    console.log(`[Queue] Max concurrent builds reached (${activeBuildsCount}/${MAX_CONCURRENT_BUILDS}). Waiting...`);
    return;
  }

  const nextTask = buildQueue.shift();
  if (!nextTask) {
    return;
  }

  activeBuildsCount++;
  console.log(`[Queue] Starting build for ${nextTask.deploymentId}. Active builds: ${activeBuildsCount}`);
  
  try {
    await nextTask.run();
  } catch (err: any) {
    console.error(`[Queue] Error running build ${nextTask.deploymentId}:`, err);
  } finally {
    activeBuildsCount--;
    console.log(`[Queue] Finished build ${nextTask.deploymentId}. Active builds: ${activeBuildsCount}`);
    processQueue();
  }
}
// --------------------------

// Ensure upload temp directory exists
const uploadDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({ dest: uploadDir });

router.post('/', requireAuth, upload.single('file'), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  // Retrieve project name or generate one from req.body or filename
  const projectName = req.body.projectName || path.basename(req.file.originalname, '.zip').replace('.collabcode-deploy', '');
  const deploymentId = `dpl_${Math.random().toString(36).substring(2, 8)}`;
  const userId = req.user?.id;
  const zipPath = req.file.path;

  // Set up chunked response for streaming build logs
  res.writeHead(200, {
    'Content-Type': 'text/plain',
    'Transfer-Encoding': 'chunked',
    'X-Content-Type-Options': 'nosniff'
  });

  const logStream = (message: string) => {
    res.write(`[LOG] ${message}`);
  };

  logStream(`Starting deployment process for project: ${projectName}...\n`);
  logStream(`Deployment ID: ${deploymentId}\n`);

  const host = req.get('host') || 'localhost:5000';
  const isLocalhost = host.includes('localhost');

  const getDeploymentUrl = (pName: string, dId: string) => {
    if (isLocalhost) {
      return `http://${pName}-${dId}.${host}`;
    } else {
      return `https://${host}/deployments/${pName}-${dId}`;
    }
  };

  const getProjectUrl = (pName: string) => {
    if (isLocalhost) {
      return `${pName}.${host}`;
    } else {
      return `https://${host}/projects/${pName}`;
    }
  };

  try {
    // 1. Create or verify the project in Supabase
    let project = null;
    try {
      const { data: existingProject } = await supabase
        .from('projects')
        .select('*')
        .eq('name', projectName)
        .eq('user_id', userId)
        .maybeSingle();

      if (!existingProject) {
        logStream(`Creating project "${projectName}" in Supabase...\n`);
        const { data: newProject, error: projectError } = await supabase
          .from('projects')
          .insert({
            user_id: userId,
            name: projectName,
            framework: 'Static',
            url: getProjectUrl(projectName),
            status: 'Ready'
          })
          .select()
          .single();

        if (projectError) {
          logStream(`Supabase Warning: ${projectError.message}. Continuing locally...\n`);
        } else {
          project = newProject;
        }
      } else {
        project = existingProject;
      }
    } catch (dbErr: any) {
      logStream(`Database lookup failed or skipped: ${dbErr.message}. Storing deployment locally...\n`);
    }

    // 2. Track deployment in Supabase as 'Queued'
    try {
      const { error: deployError } = await supabase
        .from('deployments')
        .insert({
          id: deploymentId,
          project_name: projectName,
          user_id: userId,
          status: 'Queued',
          url: getDeploymentUrl(projectName, deploymentId)
        });
      if (deployError) {
        logStream(`Supabase Deployment Tracking Warning: ${deployError.message}\n`);
      }
    } catch (dbErr: any) {
      // Ignored for offline local dev fallback
    }

    logStream(`Deployment queued. Waiting for other builds to finish...\n`);

    // 3. Queue the build and wait for it
    await new Promise<void>((resolve, reject) => {
      queueBuild(deploymentId, async () => {
        try {
          logStream(`Build slot acquired! Starting compilation...\n`);
          
          // Update status in Supabase to 'Building'
          try {
            await supabase
              .from('deployments')
              .update({ status: 'Building' })
              .eq('id', deploymentId);
          } catch (dbErr) {
            // Ignored
          }

          const buildResult = await handleBuild(zipPath, projectName, deploymentId, logStream);

          if (buildResult.success) {
            // Update deployment status to Ready in Supabase
            try {
              await supabase
                .from('deployments')
                .update({ status: 'Ready' })
                .eq('id', deploymentId);
            } catch (dbErr) {
              // Ignored
            }

            res.write(`\n[RESULT] SUCCESS\n`);
            res.write(`[RESULT] DEPLOYMENT_ID:${deploymentId}\n`);
            res.write(`[RESULT] PROJECT_NAME:${projectName}\n`);
            res.write(`[RESULT] URL:${getDeploymentUrl(projectName, deploymentId)}\n`);
          } else {
            // Update deployment status to Error in Supabase
            try {
              await supabase
                .from('deployments')
                .update({ status: 'Error' })
                .eq('id', deploymentId);
            } catch (dbErr) {
              // Ignored
            }
            res.write(`\n[RESULT] ERROR: ${buildResult.error}\n`);
          }
          resolve();
        } catch (err: any) {
          logStream(`Error during queue execution: ${err.message}\n`);
          try {
            await supabase
              .from('deployments')
              .update({ status: 'Error' })
              .eq('id', deploymentId);
          } catch (dbErr) {
            // Ignored
          }
          res.write(`\n[RESULT] ERROR: ${err.message}\n`);
          reject(err);
        }
      });
    });

  } catch (err: any) {
    logStream(`Error during deployment initialization: ${err.message}\n`);
    res.write(`\n[RESULT] ERROR: ${err.message}\n`);
  } finally {
    res.end();
  }
});

// Helper to verify GitHub Webhook signature
function verifySignature(secret: string, payload: Buffer, signature: string): boolean {
  const hmac = crypto.createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

// Background build runner
async function runBackgroundBuild(
  project: any,
  deploymentId: string,
  repoFullName: string,
  branch: string,
  commitSha: string,
  commitMessage: string,
  commitAuthor: string,
  host: string
) {
  const isLocalhost = host.includes('localhost');
  const getDeploymentUrl = (pName: string, dId: string) => {
    if (isLocalhost) {
      return `http://${pName}-${dId}.${host}`;
    } else {
      return `https://${host}/deployments/${pName}-${dId}`;
    }
  };

  // Collect logs
  let buildLogs = '';
  const logStream = (message: string) => {
    buildLogs += `[LOG] ${message}`;
    console.log(`[GitHub Build ${deploymentId}] ${message.trim()}`);
  };

  const zipPath = path.join(__dirname, '..', '..', 'uploads', `git-${deploymentId}.zip`);

  try {
    logStream(`Starting background deployment for project: ${project.name}...\n`);
    logStream(`Triggered by GitHub push to ${repoFullName} (${branch})\n`);
    logStream(`Commit: ${commitSha} - "${commitMessage}" by ${commitAuthor}\n`);

    // 1. Download zipball from GitHub
    const downloadUrl = `https://api.github.com/repos/${repoFullName}/zipball/${commitSha}`;
    logStream(`Downloading repository zipball from GitHub: ${downloadUrl}...\n`);
    
    const response = await fetch(downloadUrl, {
      headers: {
        'User-Agent': 'CollabCode-Webhook-Agent'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to download repository zipball: ${response.statusText} (${response.status})`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Ensure uploads folder exists
    const uploadDir = path.dirname(zipPath);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    await fs.promises.writeFile(zipPath, buffer);
    logStream(`Download complete. Saved to temporary location.\n`);

    // 2. Trigger build
    const buildResult = await handleBuild(zipPath, project.name, deploymentId, logStream);

    if (buildResult.success) {
      // Update deployment status to Ready in Supabase
      try {
        await supabase
          .from('deployments')
          .update({ status: 'Ready' })
          .eq('id', deploymentId);
      } catch (dbErr) {
        logStream(`Database error updating deployment to Ready: ${dbErr}\n`);
      }
      logStream(`SUCCESS: Deployment ${deploymentId} is ready!\n`);
    } else {
      // Update deployment status to Error in Supabase
      try {
        await supabase
          .from('deployments')
          .update({ status: 'Error' })
          .eq('id', deploymentId);
      } catch (dbErr) {
        logStream(`Database error updating deployment to Error: ${dbErr}\n`);
      }
      logStream(`ERROR: Build failed: ${buildResult.error}\n`);
    }
  } catch (err: any) {
    logStream(`Error during background deployment: ${err.message}\n`);
    try {
      await supabase
        .from('deployments')
        .update({ status: 'Error' })
        .eq('id', deploymentId);
    } catch (dbErr) {
      // Ignored
    }
  } finally {
    // Ensure temporary zip file is deleted
    if (fs.existsSync(zipPath)) {
      try {
        fs.unlinkSync(zipPath);
      } catch (e) {}
    }
  }
}

// GitHub webhook receiver
router.post('/webhook/github', async (req: any, res: Response): Promise<any> => {
  // 1. Verify Webhook Secret if configured
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (secret) {
    const signature = req.headers['x-hub-signature-256'] as string;
    const rawBody = req.rawBody;
    if (!signature || !rawBody || !verifySignature(secret, rawBody, signature)) {
      console.warn('[Webhook] Signature verification failed');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  // 2. Parse GitHub payload
  const repoFullName = req.body.repository?.full_name;
  const ref = req.body.ref || '';
  const branch = ref.replace('refs/heads/', '');
  const commitSha = req.body.head_commit?.id;
  const commitMessage = req.body.head_commit?.message || 'Triggered by GitHub Push';
  const commitAuthor = req.body.head_commit?.author?.name || 'GitHub';

  if (!repoFullName) {
    return res.status(400).json({ error: 'Missing repository full name' });
  }

  console.log(`[Webhook] Push event received for repo: ${repoFullName}, branch: ${branch}, commit: ${commitSha}`);

  try {
    // 3. Query all projects to find connected ones
    const { data: projects, error: projectsError } = await supabase
      .from('projects')
      .select('*');

    if (projectsError) {
      console.error('[Webhook] Error fetching projects:', projectsError);
      return res.status(500).json({ error: 'Database error fetching projects' });
    }

    // 4. Find matching project
    const project = projects?.find(p => {
      if (!p.file_system) return false;
      
      // Case-insensitive check for .cc-github.json
      const githubKey = Object.keys(p.file_system).find(k => k.toLowerCase() === '.cc-github.json');
      if (!githubKey) return false;
      
      try {
        const contentsStr = p.file_system[githubKey]?.file?.contents;
        if (!contentsStr) return false;
        const config = JSON.parse(contentsStr);
        return config.repo?.toLowerCase().trim() === repoFullName.toLowerCase().trim();
      } catch (e) {
        return false;
      }
    });

    if (!project) {
      console.log(`[Webhook] No connected project found for repo: ${repoFullName}`);
      return res.status(404).json({ error: `No connected project found for repository ${repoFullName}` });
    }

    console.log(`[Webhook] Matching project found: ${project.name} (user: ${project.user_id})`);

    // 5. Generate deployment ID and track in Supabase
    const deploymentId = `dpl_gh_${Math.random().toString(36).substring(2, 8)}`;
    const host = req.get('host') || 'localhost:5000';
    const isLocalhost = host.includes('localhost');
    const getDeploymentUrl = (pName: string, dId: string) => {
      if (isLocalhost) {
        return `http://${pName}-${dId}.${host}`;
      } else {
        return `https://${host}/deployments/${pName}-${dId}`;
      }
    };

    const { error: deployError } = await supabase
      .from('deployments')
      .insert({
        id: deploymentId,
        project_name: project.name,
        user_id: project.user_id,
        status: 'Queued',
        url: getDeploymentUrl(project.name, deploymentId)
      });

    if (deployError) {
      console.error('[Webhook] Failed to track deployment in database:', deployError);
      return res.status(500).json({ error: 'Failed to create deployment record' });
    }

    // 6. Queue the background build asynchronously
    queueBuild(deploymentId, async () => {
      // Update status to 'Building' in Supabase
      try {
        await supabase
          .from('deployments')
          .update({ status: 'Building' })
          .eq('id', deploymentId);
      } catch (dbErr) {
        // Ignored
      }

      await runBackgroundBuild(
        project,
        deploymentId,
        repoFullName,
        branch,
        commitSha || 'main',
        commitMessage,
        commitAuthor,
        host
      );
    });

    // Respond immediately to GitHub (202 Accepted)
    return res.status(202).json({
      message: 'Build queued successfully',
      deploymentId,
      projectName: project.name,
      url: getDeploymentUrl(project.name, deploymentId)
    });

  } catch (err: any) {
    console.error('[Webhook] Unexpected error:', err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
