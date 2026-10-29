FetchContent_Declare(thorvg GIT_REPOSITORY https://github.com/thorvg/thorvg.git GIT_TAG v0.15.16 GIT_SHALLOW TRUE)
FetchContent_GetProperties(thorvg)
if(NOT thorvg_POPULATED)
    FetchContent_Populate(thorvg)
endif()
file(GLOB TVG_SOURCES CONFIGURE_DEPENDS
    ${thorvg_SOURCE_DIR}/src/common/*.cpp ${thorvg_SOURCE_DIR}/src/renderer/*.cpp
    ${thorvg_SOURCE_DIR}/src/renderer/sw_engine/*.cpp
    ${thorvg_SOURCE_DIR}/src/loaders/raw/*.cpp ${thorvg_SOURCE_DIR}/src/loaders/lottie/*.cpp)
file(MAKE_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}/thorvg-config)
configure_file(${CMAKE_CURRENT_LIST_DIR}/thorvg-config.h.in ${CMAKE_CURRENT_BINARY_DIR}/thorvg-config/config.h @ONLY)
add_library(xtremetvg STATIC ${TVG_SOURCES})
set_target_properties(xtremetvg PROPERTIES POSITION_INDEPENDENT_CODE ON CXX_STANDARD 14)
target_compile_definitions(xtremetvg PUBLIC TVG_STATIC)
if(ANDROID_ABI STREQUAL "arm64-v8a")
    target_compile_definitions(xtremetvg PRIVATE THORVG_NEON_VECTOR_SUPPORT=1)
endif()
target_include_directories(xtremetvg PUBLIC ${thorvg_SOURCE_DIR}/inc PRIVATE
    ${CMAKE_CURRENT_BINARY_DIR}/thorvg-config ${thorvg_SOURCE_DIR}/src/common
    ${thorvg_SOURCE_DIR}/src/renderer ${thorvg_SOURCE_DIR}/src/renderer/sw_engine
    ${thorvg_SOURCE_DIR}/src/loaders/raw ${thorvg_SOURCE_DIR}/src/loaders/lottie)
