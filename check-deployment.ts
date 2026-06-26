import { supabase } from './src/utils/supabase';

async function check() {
  console.log(`Checking recent deployments...`);
  const { data, error } = await supabase
    .from('deployments')
    .select('*')
    .eq('project_name', 'iamironman')
    .order('created_at', { ascending: false })
    .limit(5);
    
  if (error) {
    console.error('Error fetching deployments:', error);
    return;
  }
  
  console.log('Deployments:');
  data.forEach((d: any) => console.log(`${d.id} - Status: ${d.status} - Created: ${d.created_at}`));
}

check();
