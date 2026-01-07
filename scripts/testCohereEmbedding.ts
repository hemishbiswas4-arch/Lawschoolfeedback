import dotenv from "dotenv"
dotenv.config({ path: ".env.local" })

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime"

const client = new BedrockRuntimeClient({
  region: process.env.AWS_REGION!,
})

async function test() {
  const command = new InvokeModelCommand({
    modelId: "cohere.embed-english-v3",
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({
      texts: ["test sentence"],
      input_type: "search_document",
    }),
  })

  const response = await client.send(command)
  const json = JSON.parse(new TextDecoder().decode(response.body))

  console.log("Embedding length:", json.embeddings[0].length)
}

test()
