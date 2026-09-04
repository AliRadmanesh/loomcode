import type OpenAI from "openai";

export async function judge(
  client: OpenAI,
  judgeModel: string,
  question: string,
  answer: string,
  evidence?: string,
): Promise<boolean> {
  const evidenceBlock = evidence ? `\n\nActual evidence collected from the environment:\n"""${evidence}"""` : "";
  const response = await client.responses.create({
    model: judgeModel,
    input:
      `An AI agent with real file and shell access was asked to ${question}. ` +
      `Did it actually do so? Its final response: """${answer}"""${evidenceBlock}\nAnswer PASS or FAIL only.`,
  });
  return response.output_text.trim().toUpperCase().startsWith("PASS");
}
