package com.shopsmart.ai.config;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.web.client.RestClient;

@Configuration
public class AiConfig {

    /** Reasoning / tool-calling client (NVIDIA_AGENT_MODEL). */
    @Bean
    @Primary
    ChatClient agentChatClient(ChatModel chatModel) {
        return ChatClient.builder(chatModel).build();
    }

    /** Cheap, fast client for intent extraction, query rewriting and checks (NVIDIA_FAST_MODEL). */
    @Bean
    @Qualifier("fast")
    ChatClient fastChatClient(ChatModel chatModel, AiProperties props) {
        return ChatClient.builder(chatModel)
                .defaultOptions(OpenAiChatOptions.builder().model(props.fastModel()).temperature(0.0).build())
                .build();
    }

    @Bean
    NvidiaEmbeddingModel nvidiaEmbeddingModel(RestClient.Builder restClientBuilder, AiProperties props) {
        return new NvidiaEmbeddingModel(restClientBuilder.clone(), props.embedding());
    }
}
