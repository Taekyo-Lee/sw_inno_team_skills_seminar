from gemini_cli_wrapper import ask_gemini


def main():
    """Example usage of the Gemini CLI wrapper."""
    queries = [
        "안녕",
        "What is the capital of France?",
        "Explain quantum computing in one sentence.",
    ]

    for query in queries:
        print(f"\n{'='*50}")
        print(f"Query: {query}")
        print(f"{'='*50}")
        response = ask_gemini(query)
        print(f"Response: {response}")


if __name__ == "__main__":
    main()
