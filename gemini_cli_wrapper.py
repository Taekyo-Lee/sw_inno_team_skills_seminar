#!/usr/bin/env python3
"""
A simple wrapper to call gemini-cli in headless mode.
"""

import subprocess


def ask_gemini(query: str, yolo: bool = True, sandbox: bool = False) -> str:  
    """                                                                                                                                                                                                                                                                                                                         
    Send a query to gemini-cli in headless mode and return the response.                                                                                                                                                                                                                                                        
                                                                                                                                                                                                                                                                                                                                
    Args:                                                 
        query: The user query/prompt to send to Gemini.                                                                                                                                                                                                                                                                         
        yolo: If True, auto-approve all tool calls (-y flag).                                                                                                                                                                                                                                                                   
        sandbox: If True (default), run in sandbox. Only relevant when yolo=True.                                                                                                                                                                                                                                               
                                                                                                                                                                                                                                                                                                                                
    Returns:                                                                                                                                                                                                                                                                                                                    
        The response text from Gemini, or an error message if the call fails.                                                                                                                                                                                                                                                   
    """     
    
    cmd = ["gemini", "-p", query]
    if yolo:                                                                                                                                                                                                                                                                                                                    
        cmd.append("-y")                                  
        if not sandbox:
            cmd.append("--sandbox=false")                                                                                                                                                                                                                                                                                       
    try:
        result = subprocess.run(                                                                                                                                                                                                                                                                                                
            cmd,                                          
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,                                                                                                                                                                                                                                                                                                          
        )
        result.check_returncode()                                                                                                                                                                                                                                                                                               
        return result.stdout.strip()                      
    except subprocess.CalledProcessError as e:
        return f"Error: Gemini CLI returned exit code {e.returncode}"
    except FileNotFoundError:                                                                                                                                                                                                                                                                                                   
        return "Error: 'gemini' command not found."


if __name__ == "__main__":
    # Example usage
    user_input = input("Enter your query: ")
    response = ask_gemini(user_input)
    print("--- Response ---")
    print(response)
