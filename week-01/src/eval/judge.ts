import type OpenAI from "openai";

export async function judge(
  client: OpenAI,
  judgeModel: string,
  question: string,
  answer: string,
): Promise<boolean> {
  const response = await client.responses.create({
    model: judgeModel,
    input: `Did this response correctly ${question}? Response: """${answer}"""\nAnswer PASS or FAIL only.`,
  });
  return response.output_text.trim().toUpperCase().startsWith("PASS");
}
