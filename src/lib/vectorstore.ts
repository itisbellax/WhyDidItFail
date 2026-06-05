import { SupabaseVectorStore } from '@langchain/community/vectorstores/supabase'
import { OpenAIEmbeddings } from '@langchain/openai'
import { createClient } from '@supabase/supabase-js'
import type { VectorStoreRetriever } from '@langchain/core/vectorstores'

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in environment')
  }
  return createClient(url, key)
}

function getEmbeddings() {
  return new OpenAIEmbeddings({
    model: 'text-embedding-3-small',
    openAIApiKey: process.env.OPENAI_API_KEY,
  })
}

export async function getVectorStore(): Promise<SupabaseVectorStore> {
  const client = getSupabaseClient()
  const embeddings = getEmbeddings()

  return new SupabaseVectorStore(embeddings, {
    client,
    tableName: 'print_knowledge',
    queryName: 'match_print_knowledge',
  })
}

export async function getRetriever(): Promise<VectorStoreRetriever> {
  const store = await getVectorStore()
  return store.asRetriever({ k: 3 })
}

export async function seedKnowledgeBase(): Promise<void> {
  // Lazy import to avoid bundling knowledge data into every route
  const { prusaTroubleshootingEntries } = await import(
    '@/data/knowledge/prusa-troubleshooting'
  )

  const client = getSupabaseClient()
  const embeddings = getEmbeddings()

  const texts = prusaTroubleshootingEntries.map(e => e.content)
  const metadatas = prusaTroubleshootingEntries.map(e => e.metadata)

  await SupabaseVectorStore.fromTexts(texts, metadatas, embeddings, {
    client,
    tableName: 'print_knowledge',
    queryName: 'match_print_knowledge',
  })

  console.log(`[vectorstore] Seeded ${texts.length} knowledge entries`)
}
