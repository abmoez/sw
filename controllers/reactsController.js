const React = require("./../models/reactModel");
const Post = require("./../models/postModel");
const catchAsync = require("./../utils/catchAsync");
const AppError = require("./../utils/appError");

// impelemnt addReact method
exports.addReact = catchAsync(async (req, res, next) => {
  const { postID } = req.params; // post id
  const post = await Post.findByPk(postID);

  if (!post) {
    return next(
      new AppError("React to deleted post, something went wrong", 404)
    );
  }

  await React.destroy({
    where: {
      postId: postID,
      userId: req.user.id,
    },
  });

  const react = await post.createReact({
    status: req.body.status,
    userId: req.user.id,
  });

  res.status(201).json({
    status: "success",
    data: {
      data: react,
    },
  });
});
exports.deleteReact = catchAsync(async (req, res, next) => {
  const postId = req.params.postID; // post id
  const userId = req.user.id; // User ID of the logged-in user

  // Assuming you have a React model and a relationship between User, Post, and React
  const react = await React.findOne({
    where: {
      postId,
      userId, // Ensure the react is associated with the logged-in user
    },
  });

  if (!react) {
    return next(
      new AppError("React not found or you don't have permission", 404)
    );
  }

  // Delete the found react
  await react.destroy();

  res.status(204).json({
    status: "success",
    data: null,
  });
});
exports.getAgreedReactCount = catchAsync(async (req, res, next) => {
  const postId = req.params.postID; // post id

  // Assuming you have a React model
  const agreedReactCount = await React.count({
    where: {
      postId,
      status: true, // Assuming 1 represents "agreed" reacts
    },
  });

  res.status(200).json({
    status: "success",
    data: {
      agreedReactCount,
    },
  });
});
exports.getNotAgreedReactCount = catchAsync(async (req, res, next) => {
  const postId = req.params.postID; // post id

  // Assuming you have a React model
  const notAgreedReactCount = await React.count({
    where: {
      postId,
      status: false, // Assuming 0 represents "notAgreed" reacts
    },
  });

  res.status(200).json({
    status: "success",
    data: {
      notAgreedReactCount,
    },
  });
});
