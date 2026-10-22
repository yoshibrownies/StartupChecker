import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

const client = new OpenAI();

const MODEL = "gpt-4.1-mini"; // swap if the tool isn't supported on your model

export async function callAgent<T extends z.ZodTypeAny>(opts: {
  name: string;
  instructions: string;
  input: string;
  schema: T;
  tools?: OpenAI.Responses.Tool[];
}): Promise<z.infer<T>> {
  const response = await client.responses.parse({
    model: MODEL,
    instructions: opts.instructions,
    input: opts.input,
    tools: opts.tools,
    text: { format: zodTextFormat(opts.schema, opts.name) },
  });

  if (!response.output_parsed) {
    throw new Error(`${opts.name}: model returned no parsable output`);
  }
  return response.output_parsed as z.infer<T>;
}