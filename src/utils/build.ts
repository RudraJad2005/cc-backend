import fs from 'fs';
import path from 'path';
import unzipper from 'unzipper';
import { exec } from 'child_process';
import util from 'util';
import { setRoute } from './routing';

const execAsync = util.promisify(exec);

const DEPLOYMENTS_ROOT = path.join(__dirname, '..', '..', 'deployments');
const SOURCE_DIR = path.join(DEPLOYMENTS_ROOT, 'source');
const DIST_DIR = path.join(DEPLOYMENTS_ROOT, 'dist');

if (!fs.existsSync(SOURCE_DIR)) fs.mkdirSync(SOURCE_DIR, { recursive: true });
if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR, { recursive: true });

async function getRandomPort(): Promise<number> {
  return Math.floor(Math.random() * (20000 - 10000 + 1)) + 10000;
}

export async function handleBuild(
  zipPath: string,
  projectName: string,
  deploymentId: string,
  onLog: (log: string) => void
): Promise<{ success: boolean; distPath?: string; error?: string; fileSystemTree?: any }> {
  const extractDir = path.join(SOURCE_DIR, `${projectName}-${deploymentId}`);
  const finalDistDir = path.join(DIST_DIR, `${projectName}-${deploymentId}`);
  const subdomain = `${projectName}-${deploymentId}`;

  try {
    // 1. Extract zip
    onLog('Extracting project files...\n');
    await fs.createReadStream(zipPath).pipe(unzipper.Extract({ path: extractDir })).promise();
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

    let buildSourceDir = extractDir;
    const extractedItems = fs.readdirSync(extractDir);
    if (extractedItems.length === 1) {
      const singleItemPath = path.join(extractDir, extractedItems[0]);
      if (fs.statSync(singleItemPath).isDirectory()) {
        buildSourceDir = singleItemPath;
      }
    }

    // Generate WebContainer FileSystem tree to sync to Supabase
    onLog('Parsing project file system...\n');
    const generateFileSystemTree = (dir: string): any => {
      const tree: any = {};
      const items = fs.readdirSync(dir);
      for (const item of items) {
        if (item === 'node_modules' || item === '.git' || item === '__pycache__') continue;
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          tree[item] = { directory: generateFileSystemTree(fullPath) };
        } else {
          // Read files under 1MB
          if (stat.size < 1024 * 1024) {
            try {
              const contents = fs.readFileSync(fullPath, 'utf8');
              tree[item] = { file: { contents } };
            } catch (e) {
              // Ignore binary files
            }
          }
        }
      }
      return tree;
    };
    
    const fileSystemTree = generateFileSystemTree(buildSourceDir);

    const packageJsonPath = path.join(buildSourceDir, 'package.json');
    
    // Dynamic PaaS Route (Containerization)
    if (fs.existsSync(packageJsonPath)) {
      onLog('package.json detected. Provisioning Node.js container...\n');
      
      const dockerfilePath = path.join(buildSourceDir, 'Dockerfile');
      if (!fs.existsSync(dockerfilePath)) {
        onLog('Generating default Dockerfile...\n');
        fs.writeFileSync(dockerfilePath, `
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ENV PORT=3000
EXPOSE 3000
CMD ["npm", "start"]
        `.trim());
      }

      onLog('Building Docker Image. This may take a moment...\n');
      const imageName = `cc-${deploymentId.toLowerCase()}`;
      try {
        await execAsync(`docker build -t ${imageName} .`, { cwd: buildSourceDir });
        onLog('Docker image built successfully.\n');
      } catch (buildErr: any) {
        throw new Error(`Docker build failed: ${buildErr.message}`);
      }

      const port = await getRandomPort();
      onLog(`Starting persistent container mapped to internal port ${port}...\n`);
      
      try {
        await execAsync(`docker run -d --restart=unless-stopped --name ${imageName} -p ${port}:3000 -e PORT=3000 ${imageName}`);
        onLog('Container is running in the background.\n');
      } catch (runErr: any) {
         throw new Error(`Failed to start container: ${runErr.message}`);
      }

      // Record route
      onLog('Mapping routing table...\n');
      setRoute(subdomain, `http://localhost:${port}`, 'dynamic');
      
      onLog('Deployment complete! Your API/App is live.\n');
      
      return { success: true, fileSystemTree };
    } 
    // Static File Route (Fallback)
    else {
      onLog('No package.json detected. Treating as Static HTML site...\n');
      fs.mkdirSync(finalDistDir, { recursive: true });
      fs.cpSync(buildSourceDir, finalDistDir, { recursive: true });
      
      onLog('Mapping routing table to local static directory...\n');
      setRoute(subdomain, finalDistDir, 'static');

      onLog('Static deployment complete!\n');
      return { success: true, distPath: finalDistDir, fileSystemTree };
    }

  } catch (err: any) {
    onLog(`Build error: ${err.message}\n`);
    return { success: false, error: err.message };
  }
}
