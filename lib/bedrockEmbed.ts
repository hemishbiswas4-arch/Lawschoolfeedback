import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime"

const client = new BedrockRuntimeClient({
  region: process.env.AWS_REGION!,
})

export async function embedText(text: string): Promise<number[]> {
  const command = new InvokeModelCommand({
    modelId: "cohere.embed-english-v3",
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({
      texts: [text],
      input_type: "search_document",
    }),
  })

  const response = await client.send(command)
  const json = JSON.parse(new TextDecoder().decode(response.body))

  const embedding = json?.embeddings?.[0]

  if (!Array.isArray(embedding) || embedding.length !== 1024) {
    throw new Error(
      `Invalid embedding dimensionality: ${embedding?.length}`
    )
  }

  return embedding
}
