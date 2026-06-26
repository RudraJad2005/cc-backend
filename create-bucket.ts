import { supabase } from './src/utils/supabase';

async function createBucket() {
  console.log('Checking for deployments bucket...');
  const { data, error } = await supabase.storage.getBucket('deployments');
  
  if (error && error.message.includes('not found') || !data) {
    console.log('Bucket not found. Creating deployments bucket...');
    const { data: createData, error: createError } = await supabase.storage.createBucket('deployments', {
      public: true,
      fileSizeLimit: 1024 * 1024 * 50 // 50MB
    });
    
    if (createError) {
      console.error('Failed to create bucket:', createError);
    } else {
      console.log('Bucket created successfully!');
    }
  } else if (data) {
    console.log('Bucket already exists.');
    
    // Make sure it is public
    await supabase.storage.updateBucket('deployments', {
      public: true
    });
    console.log('Bucket updated to public.');
  } else if (error) {
    console.error('Error checking bucket:', error);
  }
}

createBucket();
