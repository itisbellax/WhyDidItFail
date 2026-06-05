-- Run this in your Supabase project's SQL Editor (Dashboard → SQL Editor → New query)

-- 1. Enable the pgvector extension
create extension if not exists vector;

-- 2. Create the knowledge base table
create table if not exists print_knowledge (
  id        uuid primary key default gen_random_uuid(),
  content   text,
  embedding vector(1536),
  metadata  jsonb
);

-- 3. Create an ivfflat index for fast similarity search
create index if not exists print_knowledge_embedding_idx
  on print_knowledge
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 10);

-- 4. Create the match function LangChain's SupabaseVectorStore expects
create or replace function match_print_knowledge (
  query_embedding vector(1536),
  match_count     int default 3,
  filter          jsonb default '{}'
)
returns table (
  id         uuid,
  content    text,
  metadata   jsonb,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    print_knowledge.id,
    print_knowledge.content,
    print_knowledge.metadata,
    1 - (print_knowledge.embedding <=> query_embedding) as similarity
  from print_knowledge
  where metadata @> filter
  order by print_knowledge.embedding <=> query_embedding
  limit match_count;
end;
$$;
