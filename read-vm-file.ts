import { io } from 'socket.io-client';

function readVMFile() {
  const socket = io('https://52.172.229.65.nip.io', {
    rejectUnauthorized: false
  });

  socket.on('connect', () => {
    console.log('Connected to socket.io!');
    // Request reading build.ts file on the VM
    socket.emit('readFile', {
      projectId: '../..',
      filePath: 'cc-backend/src/utils/build.ts'
    });
  });

  socket.on('fileRead', ({ filePath, content }) => {
    console.log(`Successfully read: ${filePath}`);
    console.log('--- Content Start ---');
    console.log(content);
    console.log('--- Content End ---');
    socket.disconnect();
  });

  socket.on('fsError', (err) => {
    console.error('File system error:', err);
    socket.disconnect();
  });

  socket.on('connect_error', (err) => {
    console.error('Connection error:', err.message);
  });
}

readVMFile();
