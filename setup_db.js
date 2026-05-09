import pkg from 'pg';
const { Client } = pkg;

// Require the connection string from environment variables
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("Error: DATABASE_URL environment variable is missing.");
  process.exit(1);
}

const client = new Client({
  connectionString,
});

async function setupDatabase() {
  try {
    await client.connect();
    console.log('Connected to Supabase PostgreSQL');

    // Enable uuid extension just in case
    await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

    // Create entries table
    await client.query(`
      CREATE TABLE IF NOT EXISTS entries (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
          title TEXT,
          content TEXT NOT NULL,
          mood TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
      );
    `);
    console.log('Table "entries" created or already exists.');

    // Enable RLS
    await client.query(`ALTER TABLE entries ENABLE ROW LEVEL SECURITY;`);
    console.log('RLS enabled on "entries" table.');

    // Drop policies if they exist so we can recreate them
    await client.query(`DROP POLICY IF EXISTS "Users can view their own entries" ON entries;`);
    await client.query(`DROP POLICY IF EXISTS "Users can insert their own entries" ON entries;`);
    await client.query(`DROP POLICY IF EXISTS "Users can update their own entries" ON entries;`);
    await client.query(`DROP POLICY IF EXISTS "Users can delete their own entries" ON entries;`);

    // Create Policies
    await client.query(`
      CREATE POLICY "Users can view their own entries" 
      ON entries FOR SELECT 
      USING (auth.uid() = user_id);
    `);
    
    await client.query(`
      CREATE POLICY "Users can insert their own entries" 
      ON entries FOR INSERT 
      WITH CHECK (auth.uid() = user_id);
    `);
    
    await client.query(`
      CREATE POLICY "Users can update their own entries" 
      ON entries FOR UPDATE 
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
    `);
    
    await client.query(`
      CREATE POLICY "Users can delete their own entries" 
      ON entries FOR DELETE 
      USING (auth.uid() = user_id);
    `);
    
    console.log('RLS policies created successfully.');

    // Create attachments table
    await client.query(`
      CREATE TABLE IF NOT EXISTS entry_attachments (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          entry_id UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
          file_name TEXT NOT NULL,
          file_type TEXT,
          file_size INTEGER,
          storage_path TEXT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
      );
    `);
    console.log('Table "entry_attachments" created or already exists.');

    await client.query(`ALTER TABLE entry_attachments ENABLE ROW LEVEL SECURITY;`);

    await client.query(`DROP POLICY IF EXISTS "Users can view their own attachments" ON entry_attachments;`);
    await client.query(`DROP POLICY IF EXISTS "Users can insert their own attachments" ON entry_attachments;`);
    await client.query(`DROP POLICY IF EXISTS "Users can delete their own attachments" ON entry_attachments;`);

    await client.query(`
      CREATE POLICY "Users can view their own attachments" 
      ON entry_attachments FOR SELECT 
      USING (auth.uid() = user_id);
    `);
    await client.query(`
      CREATE POLICY "Users can insert their own attachments" 
      ON entry_attachments FOR INSERT 
      WITH CHECK (auth.uid() = user_id);
    `);
    await client.query(`
      CREATE POLICY "Users can delete their own attachments" 
      ON entry_attachments FOR DELETE 
      USING (auth.uid() = user_id);
    `);

    // Setup Storage Bucket
    try {
      await client.query(`
        INSERT INTO storage.buckets (id, name, public) 
        VALUES ('attachments', 'attachments', false) 
        ON CONFLICT (id) DO NOTHING;
      `);
      console.log('Storage bucket "attachments" created or exists.');

      // We use a simple path: user_id/entry_id/file_name
      // This means the user_id is the first element of the storage path
      await client.query(`DROP POLICY IF EXISTS "Users can upload their own attachments" ON storage.objects;`);
      await client.query(`DROP POLICY IF EXISTS "Users can view their own attachments in storage" ON storage.objects;`);
      await client.query(`DROP POLICY IF EXISTS "Users can delete their own attachments in storage" ON storage.objects;`);

      await client.query(`
        CREATE POLICY "Users can upload their own attachments"
        ON storage.objects FOR INSERT TO authenticated
        WITH CHECK (bucket_id = 'attachments' AND auth.uid()::text = (storage.foldername(name))[1]);
      `);
      await client.query(`
        CREATE POLICY "Users can view their own attachments in storage"
        ON storage.objects FOR SELECT TO authenticated
        USING (bucket_id = 'attachments' AND auth.uid()::text = (storage.foldername(name))[1]);
      `);
      await client.query(`
        CREATE POLICY "Users can delete their own attachments in storage"
        ON storage.objects FOR DELETE TO authenticated
        USING (bucket_id = 'attachments' AND auth.uid()::text = (storage.foldername(name))[1]);
      `);
      console.log('Storage policies created successfully.');
    } catch (err) {
      console.error('Warning: Could not create storage bucket/policies via SQL. You may need to create the "attachments" bucket manually in the Supabase Dashboard.', err.message);
    }

  } catch (err) {
    console.error('Error executing database setup:', err);
  } finally {
    await client.end();
  }
}

setupDatabase();
